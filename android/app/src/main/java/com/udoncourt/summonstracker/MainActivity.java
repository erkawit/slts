package com.udoncourt.summonstracker;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * v2.3.4: แสดงผลเต็มหน้าจอแบบแอปเต็มจอ (Immersive)
 * - ซ่อนแถบแจ้งเตือน (Notification/Status bar) และแถบนำทางด้านล่าง
 *   ปัดจากขอบจอเพื่อเรียกแถบขึ้นมาชั่วคราวได้ แล้วจะซ่อนเองอีกครั้ง
 * - เว้นพื้นที่ให้รอยบาก/รูกล้องหน้า (display cutout) และแป้นพิมพ์ เพื่อไม่ให้เมนู/ช่องกรอกถูกบัง
 *   (Android 15+ บังคับวาดเต็มขอบจอ ทำให้เดิมเมนูไปซ้อนอยู่ใต้แถบแจ้งเตือน)
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v2.7: ปลั๊กอินเนทีฟของแอป (คลังภาพ / เข้าสู่ระบบด้วย Google) — ต้องลงทะเบียนก่อน super.onCreate
        registerPlugin(SltsNativePlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            // แถบระบบที่ซ่อนอยู่จะคืนค่า 0 → เหลือเฉพาะรอยบากกล้อง/แป้นพิมพ์ที่ต้องเว้น
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        hideSystemBars();
        enableHardwareCameraInWebView();
        requestCoreRuntimePermissions();
    }

    /**
     * v2.3.5: กล้องในแอปเคยขึ้นเป็นไอคอน "เครื่องเล่นวีดีโอ" เพราะ WebView บล็อกการเล่นสื่ออัตโนมัติ
     * (ภาพสดจากกล้องเป็น <video>) จนกว่าผู้ใช้จะแตะ → อนุญาตให้เล่นได้ทันทีเหมือนแอปกล้องทั่วไป
     */
    private void enableHardwareCameraInWebView() {
        try {
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv != null) {
                wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) { }
    }

    /** ขอสิทธิ์กล้องและตำแหน่งตั้งแต่เปิดแอป (ระบบจะถามครั้งแรกครั้งเดียว) */
    private void requestCoreRuntimePermissions() {
        String[] perms = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            ? new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.WRITE_EXTERNAL_STORAGE // Android 9 ลงไป: บันทึกภาพลงคลังภาพ
            }
            : new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
        boolean need = false;
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) { need = true; break; }
        }
        if (need) ActivityCompat.requestPermissions(this, perms, 4101);
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // กลับจากหน้าขออนุญาต/เลือกไฟล์/แอปอื่น → ซ่อนแถบอีกครั้ง
        if (hasFocus) hideSystemBars();
    }
}

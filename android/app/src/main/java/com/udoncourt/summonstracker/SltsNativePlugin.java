package com.udoncourt.summonstracker;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * ปลั๊กอินเนทีฟของแอป SLTS (เรียกจากหน้าเว็บผ่าน Capacitor.Plugins.SltsNative)
 *  - saveImage    บันทึกภาพลงคลังภาพของโทรศัพท์ (Pictures/SLTS)
 *  - openGallery  เปิดภาพในแอปคลังภาพ (หรือเปิดแอปคลังภาพ)
 *  - googleSignIn เข้าสู่ระบบด้วยบัญชี Google (Credential Manager) → ID token ให้เซิร์ฟเวอร์ตรวจสอบ
 */
@CapacitorPlugin(name = "SltsNative")
public class SltsNativePlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        final String b64 = call.getString("base64");
        String name = call.getString("fileName");
        if (name == null || name.trim().isEmpty()) name = "SLTS_" + System.currentTimeMillis() + ".jpg";
        if (!name.toLowerCase().endsWith(".jpg") && !name.toLowerCase().endsWith(".jpeg")) name = name + ".jpg";
        final String fileName = name.replaceAll("[\\\\/:*?\"<>|]+", "-");
        if (b64 == null || b64.isEmpty()) {
            call.reject("ไม่มีข้อมูลภาพ");
            return;
        }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                Uri uri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                    v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SLTS");
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                    uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("สร้างไฟล์ในคลังภาพไม่ได้");
                    try (OutputStream os = cr.openOutputStream(uri)) {
                        if (os == null) throw new IOException("เปิดไฟล์ไม่ได้");
                        os.write(bytes);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    cr.update(uri, done, null, null);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "SLTS");
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("สร้างโฟลเดอร์ไม่ได้");
                    File f = new File(dir, fileName);
                    try (FileOutputStream fo = new FileOutputStream(f)) {
                        fo.write(bytes);
                    }
                    MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { "image/jpeg" }, null);
                    uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                }
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("บันทึกภาพลงคลังภาพไม่สำเร็จ: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void openGallery(PluginCall call) {
        String u = call.getString("uri", "");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            if (u != null && u.startsWith("content://")) {
                i.setDataAndType(Uri.parse(u), "image/*");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                i.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent g = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_GALLERY);
                g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(g);
                call.resolve();
            } catch (Exception e2) {
                call.reject("ไม่พบแอปคลังภาพในเครื่อง", e2);
            }
        }
    }

    @PluginMethod
    public void googleSignIn(PluginCall call) {
        String clientId = call.getString("serverClientId", "");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("ยังไม่ได้ตั้งค่า Google Client ID");
            return;
        }
        try {
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
            CredentialManager cm = CredentialManager.Companion.create(getContext());
            cm.getCredentialAsync(
                getActivity(),
                request,
                new CancellationSignal(),
                ContextCompat.getMainExecutor(getContext()),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse result) {
                        Credential c = result.getCredential();
                        if (c instanceof CustomCredential
                            && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                            try {
                                GoogleIdTokenCredential g = GoogleIdTokenCredential.Companion.createFrom(c.getData());
                                JSObject ret = new JSObject();
                                ret.put("idToken", g.getIdToken());
                                ret.put("email", g.getId());
                                ret.put("name", g.getDisplayName());
                                call.resolve(ret);
                            } catch (Exception e) {
                                call.reject("อ่านข้อมูลบัญชี Google ไม่สำเร็จ", e);
                            }
                        } else {
                            call.reject("ไม่ได้รับข้อมูลบัญชี Google");
                        }
                    }

                    @Override
                    public void onError(GetCredentialException e) {
                        if (e instanceof GetCredentialCancellationException) {
                            call.reject("cancelled", "CANCELLED");
                        } else if (e instanceof NoCredentialException) {
                            call.reject("ไม่พบบัญชี Google ในเครื่อง — เพิ่มบัญชีในการตั้งค่าโทรศัพท์ก่อน", "NO_ACCOUNT");
                        } else {
                            call.reject("เข้าสู่ระบบด้วย Google ไม่สำเร็จ: " + e.getMessage(), "GOOGLE_ERROR");
                        }
                    }
                }
            );
        } catch (Exception e) {
            call.reject("เปิดหน้าต่าง Google ไม่ได้: " + e.getMessage(), e);
        }
    }
}

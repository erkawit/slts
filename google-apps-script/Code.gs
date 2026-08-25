/**
 * Google Apps Script สำหรับระบบจัดเก็บข้อมูลพิกัดส่งหมาย (Summons Location Tracking System)
 * ศาลจังหวัดอุดรธานี
 * 
 * Google Drive Folder ID: 1ArsWIsoIIYeQY3o_dPrsTpBXy4pEXQuQ
 * Google Sheet ID: 1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo
 */

const FOLDER_ID = "1ArsWIsoIIYeQY3o_dPrsTpBXy4pEXQuQ";
const SPREADSHEET_ID = "1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo";
const SHEET_NAME = "บันทึกการส่งหมาย";

/**
 * ฟังก์ชันสำหรับรับคำขอแบบ POST จากเว็บแอป
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      data = e.parameter;
    } else {
      throw new Error("No data received");
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const sheet = getTargetSpreadsheet(folder);

    // ==========================================
    // ACTION 1: DELETE (ลบเฉพาะ 1 แถวเป้าหมายที่ระบุใน Google Sheet และลบไฟล์ใน Google Drive)
    // ป้องกันการลบแถวทั้งหมด 100% โดยอ้างอิง Row Index และ Drive File ID ที่ยืนยันแล้วเท่านั้น
    // ==========================================
    if (data.action === "delete") {
      let deletedRows = 0;
      let deletedFiles = 0;

      // 1. ลบไฟล์ใน Google Drive โดยอ้างอิงจาก Drive File ID โดยตรง
      if (data.fileId && typeof data.fileId === 'string' && data.fileId.trim() !== '') {
        try {
          const file = DriveApp.getFileById(data.fileId.trim());
          file.setTrashed(true);
          deletedFiles++;
        } catch (err) {
          console.warn("Delete file by ID error:", err);
        }
      }

      // 2. ตรวจสอบและค้นหาตำแหน่งแถวเป้าหมายใน Google Sheet (Exact Targeted Row)
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "ไม่มีแถวข้อมูลใน Google Sheet ให้ลบ",
          deletedRows: 0,
          deletedFiles: deletedFiles
        })).setMimeType(ContentService.MimeType.JSON);
      }

      const sheetData = sheet.getDataRange().getValues();
      let targetRowIndex = -1; // 1-indexed row number in Google Sheet (ห้ามเป็น row 1 ที่เป็นหัวตาราง)

      // 2.1 ตรวจสอบความถูกต้องของ rowIndex ที่ส่งมาจาก Client ก่อน (ถ้ามี)
      if (data.rowIndex && Number(data.rowIndex) > 1 && Number(data.rowIndex) <= lastRow) {
        const checkIdx = Number(data.rowIndex) - 1;
        const row = sheetData[checkIdx];
        if (row) {
          const rowTimestamp = String(row[0] || '').trim();
          const rowCaseNumber = String(row[1] || '').trim();
          const rowFileId = String(row[13] || '').trim();

          // ยืนยันว่าแถวที่ระบุตรงกับข้อมูลที่ต้องการลบจริง (อย่างน้อย 1 เงื่อนไขเพื่อความปลอดภัย)
          if ((data.fileId && data.fileId.trim() !== '' && rowFileId === data.fileId.trim()) ||
              (data.caseNumber && data.caseNumber.trim() !== '' && rowCaseNumber === data.caseNumber.trim()) ||
              (data.timestamp && data.timestamp.trim() !== '' && rowTimestamp === data.timestamp.trim())) {
            targetRowIndex = Number(data.rowIndex);
          }
        }
      }

      // 2.2 หาก rowIndex ไม่ตรง หรือไม่ได้ส่งมา ให้ค้นหาเฉพาะ 1 แถวที่ตรงกับ Drive File ID หรือ (Timestamp + เลขคดี)
      if (targetRowIndex === -1) {
        for (let i = 1; i < sheetData.length; i++) {
          const row = sheetData[i];
          const rowTimestamp = String(row[0] || '').trim();
          const rowCaseNumber = String(row[1] || '').trim();
          const rowFileId = String(row[13] || '').trim();

          let match = false;
          if (data.fileId && data.fileId.trim() !== '' && rowFileId === data.fileId.trim()) {
            match = true;
          } else if (data.caseNumber && data.caseNumber.trim() !== '' && data.timestamp && data.timestamp.trim() !== '' &&
                     rowCaseNumber === data.caseNumber.trim() && rowTimestamp === data.timestamp.trim()) {
            match = true;
          }

          if (match) {
            targetRowIndex = i + 1;
            break; // ลบเฉพาะ 1 แถวที่พบเท่านั้น! ไม่วนลบต่อ
          }
        }
      }

      // 2.3 ดำเนินการลบเฉพาะ 1 แถวเป้าหมายเท่านั้น (และต้องไม่ใช่หัวตาราง Row 1)
      if (targetRowIndex > 1 && targetRowIndex <= lastRow) {
        sheet.deleteRow(targetRowIndex);
        deletedRows = 1;
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: deletedRows > 0 
          ? `ลบรายการแถวที่ ${targetRowIndex} ใน Google Sheet และลบไฟล์ใน Google Drive เรียบร้อยแล้ว` 
          : `ไม่พบแถวที่ตรงกับเงื่อนไขใน Google Sheet (ลบไฟล์ใน Drive: ${deletedFiles} ไฟล์)`,
        deletedRows: deletedRows,
        deletedFiles: deletedFiles,
        targetRowIndex: targetRowIndex
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION 2: RECORD_INITIAL (บันทึกลงชีตทันทีหลังกดถ่ายภาพ แม้ยังไม่กดส่ง Drive)
    // ==========================================
    if (data.action === "record_initial") {
      const timestamp = new Date();
      const thaiDateStr = data.dateTime || Utilities.formatDate(timestamp, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

      sheet.appendRow([
        thaiDateStr,                               // 1. วันที่เวลาบันทึก
        data.caseNumber || "",                     // 2. เลขคดี
        data.courtType || "",                      // 3. ประเภทศาล
        data.district || "",                       // 4. อำเภอ
        data.subdistrict || "",                    // 5. ตำบล
        data.locationType || "",                   // 6. ประเภทสถานที่
        data.locationText || "",                   // 7. ที่ตั้งสถานที่ส่งหมาย (แบบเต็ม)
        data.lat ? Number(data.lat) : "",          // 8. ละติจูด (Latitude)
        data.lng ? Number(data.lng) : "",          // 9. ลองจิจูด (Longitude)
        data.heading !== undefined ? data.heading : "", // 10. ทิศองศา
        data.fileName || "",                       // 11. ชื่อไฟล์ภาพ
        "",                                        // 12. ลิงก์รูปภาพใน Google Drive (ยังไม่มี)
        "",                                        // 13. ลิงก์ Text File (ยกเลิกการใช้)
        ""                                         // 14. Drive File ID
      ]);

      const lastRow = sheet.getLastRow();

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "บันทึกข้อมูลรายละเอียดลงใน Google Sheet เรียบร้อยแล้ว",
        rowIndex: lastRow,
        timestamp: thaiDateStr,
        caseNumber: data.caseNumber
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION 3: UPLOAD_IMAGE (อัปโหลดรูปภาพลง Google Drive และอัปเดต/เพิ่มแถวในชีต)
    // ==========================================
    let fileUrl = "";
    let fileId = "";

    // หากเป็นการแทนที่ไฟล์เดิม (Overwrite) และมี oldFileId ให้ย้ายไฟล์เดิมใน Drive ไปยังถังขยะ
    if (data.overwrite && data.oldFileId) {
      try {
        const oldFile = DriveApp.getFileById(data.oldFileId);
        oldFile.setTrashed(true);
      } catch (err) {
        console.warn("Trash old file error:", err);
      }
    }

    // บันทึกรูปภาพ (Base64) ลงใน Google Drive Folder (ไม่สร้างไฟล์ .txt)
    if (data.imageBase64 && data.fileName) {
      let base64String = data.imageBase64;
      if (base64String.indexOf("base64,") !== -1) {
        base64String = base64String.split("base64,")[1];
      }
      
      const decodedBytes = Utilities.base64Decode(base64String);
      const blob = Utilities.newBlob(decodedBytes, "image/jpeg", data.fileName);
      const createdFile = folder.createFile(blob);
      
      createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = createdFile.getUrl();
      fileId = createdFile.getId();
    }

    const sheetData = sheet.getDataRange().getValues();
    let targetRowIndex = -1;

    // 1. ถ้าเป็นการระบุ rowIndex โดยตรง
    if (data.rowIndex && Number(data.rowIndex) > 1 && Number(data.rowIndex) <= sheetData.length) {
      targetRowIndex = Number(data.rowIndex);
    } else {
      // 2. ค้นหาแถวที่ตรงกัน
      for (let i = sheetData.length - 1; i >= 1; i--) {
        const row = sheetData[i];
        const rowTimestamp = String(row[0] || '').trim();
        const rowCaseNumber = String(row[1] || '').trim();
        const rowImgUrl = String(row[11] || '').trim();

        if (data.timestamp && rowTimestamp === data.timestamp && rowCaseNumber === data.caseNumber) {
          targetRowIndex = i + 1;
          break;
        } else if (!data.isNewRecord && rowCaseNumber === data.caseNumber && (!rowImgUrl || rowImgUrl === "")) {
          targetRowIndex = i + 1;
          break;
        }
      }
    }

    if (targetRowIndex !== -1 && !data.isNewRecord) {
      // อัปเดตแถวเดิมใน Google Sheet (แทนที่รูปภาพ หรือใส่ภาพในแถวที่ว่าง)
      sheet.getRange(targetRowIndex, 11).setValue(data.fileName || "");
      sheet.getRange(targetRowIndex, 12).setValue(fileUrl);
      sheet.getRange(targetRowIndex, 14).setValue(fileId);
    } else {
      // เพิ่มข้อมูลใหม่ (Append New Row)
      const timestamp = new Date();
      const thaiDateStr = data.dateTime || Utilities.formatDate(timestamp, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

      sheet.appendRow([
        thaiDateStr,
        data.caseNumber || "",
        data.courtType || "",
        data.district || "",
        data.subdistrict || "",
        data.locationType || "",
        data.locationText || "",
        data.lat ? Number(data.lat) : "",
        data.lng ? Number(data.lng) : "",
        data.heading !== undefined ? data.heading : "",
        data.fileName || "",
        fileUrl || "",
        "",
        fileId || ""
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: data.overwrite ? "แทนที่รูปภาพเดิมใน Google Drive & Sheet เรียบร้อยแล้ว" : "บันทึกรูปภาพลง Google Drive & Sheet สำเร็จ",
      fileUrl: fileUrl,
      fileId: fileId,
      caseNumber: data.caseNumber,
      isOverwrite: !!data.overwrite
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึง Google Sheet ตาม Spreadsheet ID ที่กำหนด
 */
function getTargetSpreadsheet(folder) {
  let spreadsheet;

  try {
    spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (err) {
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    if (files.hasNext()) {
      spreadsheet = SpreadsheetApp.open(files.next());
    } else {
      spreadsheet = SpreadsheetApp.create("ข้อมูลการส่งหมาย_ศาลจังหวัดอุดรธานี");
      const ssFile = DriveApp.getFileById(spreadsheet.getId());
      folder.addFile(ssFile);
      DriveApp.getRootFolder().removeFile(ssFile);
    }
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.getActiveSheet();
    sheet.setName(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    const headers = [
      "วัน-เวลาบันทึก",
      "เลขคดี",
      "ประเภทศาล",
      "อำเภอ",
      "ตำบล",
      "ประเภทสถานที่",
      "ที่ตั้งส่งหมาย (เต็ม)",
      "ละติจูด (Lat)",
      "ลองจิจูด (Lng)",
      "ทิศองศา",
      "ชื่อไฟล์รูปภาพ",
      "ลิงก์รูปภาพใน Google Drive",
      "ลิงก์ Text File ใน Google Drive",
      "Drive File ID"
    ];

    sheet.appendRow(headers);
    
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#2563eb");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * ฟังก์ชันทดสอบการทำงานผ่าน Browser (GET)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "Summons Location Tracking API is running.",
    folderId: FOLDER_ID,
    spreadsheetId: SPREADSHEET_ID
  })).setMimeType(ContentService.MimeType.JSON);
}

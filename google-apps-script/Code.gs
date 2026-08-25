/**
 * Google Apps Script สำหรับระบบจัดเก็บข้อมูลพิกัดส่งหมาย (Summons Location Tracking System)
 * ศาลจังหวัดอุดรธานี
 * 
 * Google Drive Folder ID: 1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp
 * Google Sheet ID: 1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo
 */

const FOLDER_ID = "1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp";
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
    // ACTION 1: DELETE (เฉพาะสิทธิ์ Admin)
    // ==========================================
    if (data.action === "delete") {
      let deletedRows = 0;
      let deletedFiles = 0;

      // ลบไฟล์ภาพใน Google Drive
      if (data.fileId) {
        try {
          const file = DriveApp.getFileById(data.fileId);
          file.setTrashed(true);
          deletedFiles++;
        } catch (err) {
          console.warn("Delete file by ID error:", err);
        }
      }

      if (data.fileName) {
        try {
          const imgFiles = folder.getFilesByName(data.fileName);
          while (imgFiles.hasNext()) {
            imgFiles.next().setTrashed(true);
            deletedFiles++;
          }
        } catch (err) {
          console.warn("Delete files by name error:", err);
        }
      }

      // ลบแถวใน Google Sheet
      const sheetData = sheet.getDataRange().getValues();
      for (let i = sheetData.length - 1; i >= 1; i--) {
        const row = sheetData[i];
        const rowTimestamp = String(row[0] || '').trim();
        const rowCaseNumber = String(row[1] || '').trim();
        const rowFileName = String(row[10] || '').trim();
        const rowFileId = String(row[13] || '').trim();

        let isMatch = false;
        if (data.fileId && rowFileId === data.fileId) isMatch = true;
        else if (data.fileName && rowFileName === data.fileName) isMatch = true;
        else if (data.timestamp && data.caseNumber && rowTimestamp === data.timestamp && rowCaseNumber === data.caseNumber) isMatch = true;
        else if (data.rowIndex && Number(data.rowIndex) === (i + 1)) isMatch = true;

        if (isMatch) {
          sheet.deleteRow(i + 1);
          deletedRows++;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: `ลบรายการใน Google Sheet (${deletedRows} แถว) และไฟล์ใน Drive (${deletedFiles} ไฟล์) เรียบร้อยแล้ว`,
        deletedRows: deletedRows,
        deletedFiles: deletedFiles
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
    // ACTION 3: UPLOAD_IMAGE (อัปโหลดรูปภาพลง Google Drive และอัปเดตแถวในชีต)
    // ==========================================
    let fileUrl = "";
    let fileId = "";

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

    // ตรวจสอบว่ามีแถวเดิมที่บันทึกไว้ใน record_initial หรือไม่
    const sheetData = sheet.getDataRange().getValues();
    let targetRowIndex = -1;

    for (let i = sheetData.length - 1; i >= 1; i--) {
      const row = sheetData[i];
      const rowCaseNumber = String(row[1] || '').trim();
      const rowFileName = String(row[10] || '').trim();
      const rowImgUrl = String(row[11] || '').trim();

      if (rowCaseNumber === data.caseNumber && (!rowImgUrl || rowImgUrl === "") && (!data.fileName || rowFileName === data.fileName)) {
        targetRowIndex = i + 1;
        break;
      }
    }

    if (targetRowIndex !== -1) {
      // อัปเดตช่องลิงก์รูปภาพ (Column 12) และ File ID (Column 14)
      sheet.getRange(targetRowIndex, 12).setValue(fileUrl);
      sheet.getRange(targetRowIndex, 14).setValue(fileId);
    } else {
      // ถ้าไม่พบแถวเดิม ให้สร้างแถวใหม่สมบูรณ์
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
      message: "บันทึกรูปภาพลง Google Drive & Sheet สำเร็จ",
      fileUrl: fileUrl,
      fileId: fileId,
      caseNumber: data.caseNumber
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

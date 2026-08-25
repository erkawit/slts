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
 * ฟังก์ชันสำหรับรับคำขอแบบ POST จากเว็บแอป (บันทึกข้อมูล หรือ ลบข้อมูล)
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
    // ACTION: DELETE (เฉพาะสิทธิ์ Admin)
    // ==========================================
    if (data.action === "delete") {
      let deletedRows = 0;
      let deletedFiles = 0;

      // 1. ลบไฟล์ใน Google Drive (ภาพถ่าย และ Text File)
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
          // ลบไฟล์ภาพ
          const imgFiles = folder.getFilesByName(data.fileName);
          while (imgFiles.hasNext()) {
            imgFiles.next().setTrashed(true);
            deletedFiles++;
          }
          // ลบ Text File
          const txtFileName = data.fileName.replace(/\.jpg$/i, '.txt');
          const txtFiles = folder.getFilesByName(txtFileName);
          while (txtFiles.hasNext()) {
            txtFiles.next().setTrashed(true);
            deletedFiles++;
          }
        } catch (err) {
          console.warn("Delete files by name error:", err);
        }
      }

      // 2. ลบแถวใน Google Sheet
      const sheetData = sheet.getDataRange().getValues();
      // ค้นหาแถวที่ตรงกับ fileId หรือ (timestamp และ caseNumber)
      for (let i = sheetData.length - 1; i >= 1; i--) { // วนจากล่างขึ้นบน
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
    // ACTION: SAVE / CREATE NEW RECORD
    // ==========================================
    let fileUrl = "";
    let fileId = "";
    let txtFileUrl = "";
    let txtFileId = "";

    // 1. บันทึกรูปภาพ (Base64) ลงใน Google Drive Folder
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

    // 2. บันทึก Text File (.txt) ข้อมูลลายน้ำลงใน Google Drive Folder
    if (data.textContent && data.fileName) {
      const txtFileName = data.fileName.replace(/\.jpg$/i, '.txt');
      const createdTxtFile = folder.createFile(txtFileName, data.textContent, MimeType.PLAIN_TEXT);
      createdTxtFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      txtFileUrl = createdTxtFile.getUrl();
      txtFileId = createdTxtFile.getId();
    }

    // 3. บันทึกข้อมูลลง Google Sheets
    const timestamp = new Date();
    const thaiDateStr = Utilities.formatDate(timestamp, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

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
      fileUrl || "",                             // 12. ลิงก์รูปภาพใน Google Drive
      txtFileUrl || "",                          // 13. ลิงก์ Text File ใน Google Drive
      fileId || ""                               // 14. Drive File ID
    ]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "บันทึกข้อมูล รูปภาพ และ Text File ลง Google Drive & Sheet สำเร็จ",
      fileUrl: fileUrl,
      txtFileUrl: txtFileUrl,
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

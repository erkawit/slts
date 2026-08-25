/**
 * Google Apps Script สำหรับระบบจัดเก็บข้อมูลพิกัดส่งหมาย (Summons Location Tracking System)
 * ศาลจังหวัดอุดรธานี
 * 
 * Folder ID: 1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp
 */

const FOLDER_ID = "1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp";
const SHEET_NAME = "บันทึกการส่งหมาย";

/**
 * ฟังก์ชันสำหรับรับคำขอแบบ POST จากเว็บแอป
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // รอคิวไม่เกิน 30 วินาทีเพื่อป้องกัน race condition ในการเขียนชีต
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
    let fileUrl = "";
    let fileId = "";

    // 1. บันทึกรูปภาพ (Base64) ลงใน Google Drive Folder
    if (data.imageBase64 && data.fileName) {
      // ตัด prefix เช่น "data:image/jpeg;base64," ออกหากมี
      let base64String = data.imageBase64;
      if (base64String.indexOf("base64,") !== -1) {
        base64String = base64String.split("base64,")[1];
      }
      
      const decodedBytes = Utilities.base64Decode(base64String);
      const blob = Utilities.newBlob(decodedBytes, "image/jpeg", data.fileName);
      const createdFile = folder.createFile(blob);
      
      // ตั้งสิทธิ์ให้อ่านได้ผ่านลิงก์
      createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = createdFile.getUrl();
      fileId = createdFile.getId();
    }

    // 2. บันทึกข้อมูลลง Google Sheets
    const sheet = getOrCreateSpreadsheet(folder);
    
    const timestamp = new Date();
    const thaiDateStr = Utilities.formatDate(timestamp, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

    // เพิ่มแถวข้อมูลใหม่
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
      fileUrl || "",                             // 12. ลิงก์ดูภาพใน Google Drive
      fileId || ""                               // 13. File ID
    ]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "บันทึกข้อมูลและรูปภาพลง Google Drive สำเร็จ",
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
 * ตรวจสอบหรือสร้าง Google Sheets ภายใน Folder
 */
function getOrCreateSpreadsheet(folder) {
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  let spreadsheet;
  
  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
  } else {
    spreadsheet = SpreadsheetApp.create("ข้อมูลการส่งหมาย_ศาลจังหวัดอุดรธานี");
    const ssFile = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(ssFile);
    DriveApp.getRootFolder().removeFile(ssFile);
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.getActiveSheet();
    sheet.setName(SHEET_NAME);
    
    // สร้างหัวตาราง (Header)
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
      "Drive File ID"
    ];

    sheet.appendRow(headers);
    
    // จัดสไตล์หัวตาราง
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
    message: "Summons Location Tracking API (Google Apps Script) is running.",
    folderId: FOLDER_ID
  })).setMimeType(ContentService.MimeType.JSON);
}

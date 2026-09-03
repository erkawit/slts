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
const USERS_SHEET_NAME = "users";
const HANDOFF_SHEET_NAME = "device_handoff";

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

    let folder;
    try {
      folder = DriveApp.getFolderById(FOLDER_ID);
    } catch (fe) {
      folder = DriveApp.getRootFolder();
    }
    const spreadsheet = getTargetSpreadsheetFile(folder);

    // ==========================================
    // ACTION: DEVICE_HANDOFF (การส่งข้อมูลพิกัดและเส้นทางข้ามอุปกรณ์ Cross-Device Handoff)
    // ==========================================
    if (data.action === "send_handoff") {
      const handoffSheet = getHandoffSheet(spreadsheet);
      const targetUserId = String(data.user_id || data.username || 'anonymous').trim();
      const timestamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
      const hData = handoffSheet.getDataRange().getValues();

      let foundRow = -1;
      for (let i = 1; i < hData.length; i++) {
        if (String(hData[i][0] || '').trim().toLowerCase() === targetUserId.toLowerCase()) {
          foundRow = i + 1;
          break;
        }
      }

      const rowValues = [
        targetUserId,
        String(data.queryString || ''),
        String(data.fullAddress || ''),
        String(data.caseNumber || ''),
        typeof data.stops === 'object' ? JSON.stringify(data.stops) : String(data.stops || '[]'),
        String(data.lat || ''),
        String(data.lng || ''),
        "pending",
        timestamp,
        timestamp
      ];

      if (foundRow !== -1) {
        handoffSheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        handoffSheet.appendRow(rowValues);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Handoff payload sent to pending state",
        user_id: targetUserId,
        timestamp: timestamp
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "get_pending_handoff") {
      const handoffSheet = getHandoffSheet(spreadsheet);
      const targetUserId = String(data.user_id || data.username || '').trim();
      const hData = handoffSheet.getDataRange().getValues();

      let pendingItem = null;
      for (let i = 1; i < hData.length; i++) {
        const uId = String(hData[i][0] || '').trim().toLowerCase();
        const status = String(hData[i][7] || '').trim().toLowerCase();
        if (uId === targetUserId.toLowerCase() && status === "pending") {
          let parsedStops = [];
          try {
            parsedStops = JSON.parse(hData[i][4] || '[]');
          } catch (pe) {
            parsedStops = [];
          }

          pendingItem = {
            user_id: hData[i][0],
            queryString: hData[i][1],
            fullAddress: hData[i][2],
            caseNumber: hData[i][3],
            stops: parsedStops,
            lat: hData[i][5] ? parseFloat(hData[i][5]) : null,
            lng: hData[i][6] ? parseFloat(hData[i][6]) : null,
            status: hData[i][7],
            timestamp: hData[i][8],
            updated_at: hData[i][9]
          };
          break;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        hasPending: Boolean(pendingItem),
        handoff: pendingItem
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "ack_handoff") {
      const handoffSheet = getHandoffSheet(spreadsheet);
      const targetUserId = String(data.user_id || data.username || '').trim();
      const timestamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
      const hData = handoffSheet.getDataRange().getValues();

      let updated = false;
      for (let i = 1; i < hData.length; i++) {
        const uId = String(hData[i][0] || '').trim().toLowerCase();
        if (uId === targetUserId.toLowerCase()) {
          handoffSheet.getRange(i + 1, 8).setValue("received");
          handoffSheet.getRange(i + 1, 10).setValue(timestamp);
          updated = true;
          break;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: updated ? "Handoff status updated to received" : "User record not found",
        updated: updated,
        timestamp: timestamp
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION: LOG_ACTIVITY (บันทึกประวัติการนำเข้าและใช้งานแผนที่ลงไฟล์ Log บน Google Drive)
    // ==========================================
    if (data.action === "log_activity" || data.action === "log_map_action") {
      const logFileName = "map_activity_logs.log";
      const files = folder.getFilesByName(logFileName);
      let logFile;
      if (files.hasNext()) {
        logFile = files.next();
      } else {
        logFile = folder.createFile(logFileName, "=== ระบบบันทึกประวัติการใช้งานแผนที่และหมุด (SLTS Audit Logs) ===\n\n");
      }

      const timestamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
      const user = data.user || {};
      const username = user.username || data.username || "anonymous";
      const name = user.name || data.name || username;
      const role = user.role || data.role || "user";
      const actionType = data.actionType || data.activity || "MAP_ACTION";
      const details = data.details || data.message || "-";
      const extra = data.extra ? ` | DATA: ${JSON.stringify(data.extra)}` : "";

      const logEntry = `[${timestamp}] [USER: ${name} (@${username}) | ROLE: ${role}] [ACTION: ${actionType}] [DETAILS: ${details}]${extra}\n`;

      // ต่อท้ายเนื้อหาไฟล์ Log
      const existingContent = logFile.getBlob().getDataAsString();
      logFile.setContent(existingContent + logEntry);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Logged successfully",
        timestamp: timestamp
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION: GET_DATA (ดึงข้อมูลบันทึกการส่งหมายทั้งหมด)
    // ==========================================
    if (data.action === "get_data" || data.action === "get_summons") {
      const sheet = getSummonsSheet(spreadsheet);
      const sData = sheet.getDataRange().getValues();
      const rows = [];
      if (sData.length > 1) {
        const headers = sData[0];
        for (let i = 1; i < sData.length; i++) {
          if (!sData[i][0] && !sData[i][1]) continue;
          const rowObj = {};
          for (let j = 0; j < headers.length; j++) {
            const h = String(headers[j] || '').trim();
            let val = sData[i][j];
            if (val instanceof Date) {
              val = Utilities.formatDate(val, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");
            }
            rowObj[h] = val !== undefined && val !== null ? String(val) : '';
          }
          rows.push(rowObj);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        data: rows
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION: USER MANAGEMENT (จัดการผู้ใช้งานใน Sheet 'users')
    // ==========================================
    if (data.action === "get_users") {
      const usersSheet = getUsersSheet(spreadsheet);
      const uData = usersSheet.getDataRange().getValues();
      const usersList = [];
      for (let i = 1; i < uData.length; i++) {
        if (uData[i][0]) {
          const courtCat = String(uData[i][5] || 'ศาลจังหวัด').trim();
          let courtName = String(uData[i][6] || '').trim();
          const prov = String(uData[i][7] || 'อุดรธานี').trim();
          if (!courtName) {
            if (courtCat === 'ศาลไม่สังกัดภาค') courtName = 'ศาลแพ่ง';
            else if (courtCat === 'ศาลแขวง') courtName = 'ศาลแขวง' + prov;
            else if (courtCat === 'ศาลเยาวชนและครอบครัว') courtName = 'ศาลเยาวชนและครอบครัวจังหวัด' + prov;
            else courtName = 'ศาลจังหวัด' + prov;
          }
          usersList.push({
            username: String(uData[i][0] || '').trim(),
            password: String(uData[i][1] || '').trim(),
            role: String(uData[i][2] || 'user').trim(),
            name: String(uData[i][3] || uData[i][0]).trim(),
            createdAt: String(uData[i][4] || '').trim(),
            courtCategory: courtCat,
            assignedCourt: courtName,
            assignedProvince: prov
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        users: usersList
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "save_user" || data.action === "update_user_password" || data.action === "update_user_profile") {
      const usersSheet = getUsersSheet(spreadsheet);
      const uData = usersSheet.getDataRange().getValues();
      const targetUsername = String(data.username || '').trim();
      if (!targetUsername) {
        throw new Error("ไม่พบชื่อผู้ใช้งาน (Username is required)");
      }

      let foundRow = -1;
      for (let i = 1; i < uData.length; i++) {
        if (String(uData[i][0] || '').trim().toLowerCase() === targetUsername.toLowerCase()) {
          foundRow = i + 1;
          break;
        }
      }

      const dateNow = data.createdAt || Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy");
      const courtCat = String(data.courtCategory || data['ประเภทศาล'] || 'ศาลจังหวัด').trim();
      const courtName = String(data.assignedCourt || data['ศาลที่สังกัด'] || data['ชื่อศาล'] || '').trim();
      const prov = String(data.assignedProvince || data['จังหวัดรับผิดชอบ'] || data['จังหวัด'] || 'อุดรธานี').trim();

      if (foundRow !== -1) {
        // อัปเดตข้อมูลผู้ใช้เดิม
        if (data.password) usersSheet.getRange(foundRow, 2).setValue(String(data.password));
        if (data.role && targetUsername !== 'admin') usersSheet.getRange(foundRow, 3).setValue(String(data.role));
        if (data.name) usersSheet.getRange(foundRow, 4).setValue(String(data.name));
        if (courtCat) usersSheet.getRange(foundRow, 6).setValue(courtCat);
        if (courtName) usersSheet.getRange(foundRow, 7).setValue(courtName);
        if (prov) usersSheet.getRange(foundRow, 8).setValue(prov);
      } else {
        // เพิ่มผู้ใช้ใหม่
        usersSheet.appendRow([
          targetUsername,
          String(data.password || '123456'),
          String(data.role || 'user'),
          String(data.name || targetUsername),
          dateNow,
          courtCat,
          courtName || (prov ? `ศาลจังหวัด${prov}` : 'ศาลจังหวัดอุดรธานี'),
          prov
        ]);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: `บันทึกข้อมูลผู้ใช้ @${targetUsername} ใน Google Sheet สำเร็จ`
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "delete_user") {
      const usersSheet = getUsersSheet(spreadsheet);
      const targetUsername = String(data.username || '').trim();
      if (targetUsername.toLowerCase() === 'admin') {
        throw new Error("ไม่สามารถลบผู้ดูแลระบบหลัก (admin) ได้");
      }

      const uData = usersSheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < uData.length; i++) {
        if (String(uData[i][0] || '').trim().toLowerCase() === targetUsername.toLowerCase()) {
          foundRow = i + 1;
          break;
        }
      }

      if (foundRow > 1) {
        usersSheet.deleteRow(foundRow);
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: `ลบผู้ใช้ @${targetUsername} ออกจาก Google Sheet เรียบร้อยแล้ว`
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: `ไม่พบผู้ใช้ @${targetUsername} ใน Google Sheet`
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === "sync_all_users" && Array.isArray(data.users)) {
      const usersSheet = getUsersSheet(spreadsheet);
      const uData = usersSheet.getDataRange().getValues();
      const existingUsernames = new Set();
      for (let i = 1; i < uData.length; i++) {
        existingUsernames.add(String(uData[i][0] || '').trim().toLowerCase());
      }

      data.users.forEach(u => {
        const uName = String(u.username || '').trim();
        if (uName && !existingUsernames.has(uName.toLowerCase())) {
          const prov = String(u.assignedProvince || 'อุดรธานี').trim();
          const courtCat = String(u.courtCategory || 'ศาลจังหวัด').trim();
          const courtName = String(u.assignedCourt || (prov ? `ศาลจังหวัด${prov}` : 'ศาลจังหวัดอุดรธานี')).trim();
          usersSheet.appendRow([
            uName,
            String(u.password || '123456'),
            String(u.role || 'user'),
            String(u.name || uName),
            String(u.createdAt || Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy")),
            courtCat,
            courtName,
            prov
          ]);
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "ซิงค์รายชื่อผู้ใช้งานกับ Google Sheet สำเร็จ"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // ACTION 1: DELETE (ลบเฉพาะ 1 แถวเป้าหมายที่ระบุใน Google Sheet และลบไฟล์ใน Google Drive)
    // ป้องกันการลบแถวทั้งหมด 100% โดยอ้างอิง Row Index และ Drive File ID ที่ยืนยันแล้วเท่านั้น
    // ==========================================
    if (data.action === "delete") {
      const sheet = getSummonsSheet(spreadsheet);
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
    // ACTION: EDIT_RECORD / UPDATE_RECORD (แก้ไขข้อมูลส่งหมายใน Google Sheet และอัปเดตไฟล์ใน Google Drive)
    // ==========================================
    if (data.action === "edit_record" || data.action === "update_record") {
      const sheet = getSummonsSheet(spreadsheet);
      const sheetData = sheet.getDataRange().getValues();
      let targetRowIndex = -1;

      if (data.rowIndex && Number(data.rowIndex) > 1 && Number(data.rowIndex) <= sheetData.length) {
        targetRowIndex = Number(data.rowIndex);
      } else if (data.oldFileId) {
        for (let i = sheetData.length - 1; i >= 1; i--) {
          if (String(sheetData[i][13] || '').trim() === String(data.oldFileId).trim()) {
            targetRowIndex = i + 1;
            break;
          }
        }
      } else if (data.caseNumber && data.timestamp) {
        for (let i = sheetData.length - 1; i >= 1; i--) {
          const rowTs = String(sheetData[i][0] || '').trim();
          const rowCase = String(sheetData[i][1] || '').trim();
          if (rowCase === String(data.caseNumber).trim() && rowTs === String(data.timestamp).trim()) {
            targetRowIndex = i + 1;
            break;
          }
        }
      }

      let fileUrl = data.fileUrl || "";
      let fileId = data.fileId || "";

      // หากมีการอัปโหลดรูปภาพใหม่เพื่อทับไฟล์เดิม
      if (data.imageBase64 && data.fileName) {
        if (data.oldFileId) {
          try {
            const oldFile = DriveApp.getFileById(data.oldFileId);
            oldFile.setTrashed(true);
          } catch (err) {
            console.warn("Trash old file error on edit:", err);
          }
        }

        let base64String = data.imageBase64;
        if (base64String.indexOf("base64,") !== -1) {
          base64String = base64String.split("base64,")[1];
        }
        const decodedBytes = Utilities.base64Decode(base64String);
        const blob = Utilities.newBlob(decodedBytes, "image/jpeg", data.fileName);
        const createdFile = folder.createFile(blob);
        fileId = createdFile.getId();
        fileUrl = createdFile.getUrl();
      }

      // ตรวจสอบสิทธิ์การแก้ไข (Permission Check):
      // อนุญาตเฉพาะ Admin หรือผู้ที่บันทึกข้อมูลนั้นๆ เท่านั้น
      const currentEditingUser = String(data.uploader || data.username || data.user_id || '').trim().toLowerCase();
      const currentRole = String(data.role || data.uploaderRole || '').trim().toLowerCase();

      if (targetRowIndex > 1 && targetRowIndex <= sheetData.length) {
        const rowUploader = String(sheetData[targetRowIndex - 1][14] || '').trim().toLowerCase();
        if (currentRole !== 'admin' && rowUploader && currentEditingUser && rowUploader !== currentEditingUser) {
          return ContentService.createTextOutput(JSON.stringify({
            status: "error",
            message: `ท่านไม่มีสิทธิ์แก้ไขข้อมูลนี้ (สามารถแก้ไขได้เฉพาะผู้บันทึก @${rowUploader} หรือผู้ดูแลระบบเท่านั้น)`
          })).setMimeType(ContentService.MimeType.JSON);
        }

        if (data.caseNumber) sheet.getRange(targetRowIndex, 2).setValue(data.caseNumber);
        if (data.courtType) sheet.getRange(targetRowIndex, 3).setValue(data.courtType);
        if (data.district) sheet.getRange(targetRowIndex, 4).setValue(data.district);
        if (data.subdistrict) sheet.getRange(targetRowIndex, 5).setValue(data.subdistrict);
        if (data.locationType) sheet.getRange(targetRowIndex, 6).setValue(data.locationType);
        if (data.locationText) sheet.getRange(targetRowIndex, 7).setValue(data.locationText);
        if (data.lat) sheet.getRange(targetRowIndex, 8).setValue(Number(data.lat));
        if (data.lng) sheet.getRange(targetRowIndex, 9).setValue(Number(data.lng));
        if (data.heading !== undefined) sheet.getRange(targetRowIndex, 10).setValue(data.heading);

        if (fileUrl && fileId) {
          sheet.getRange(targetRowIndex, 11).setValue(data.fileName || "");
          sheet.getRange(targetRowIndex, 12).setValue(fileUrl);
          sheet.getRange(targetRowIndex, 14).setValue(fileId);
        }

        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: `แก้ไขข้อมูลเลขคดี ${data.caseNumber} เรียบร้อยแล้ว`,
          targetRowIndex: targetRowIndex,
          fileUrl: fileUrl,
          fileId: fileId
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        // หากไม่พบแถวเดิม ให้ append เข้าไปใหม่
        sheet.appendRow([
          data.dateTime || Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss"),
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
          fileId || "",
          data.uploader || data.username || data.uploadedBy || ""
        ]);
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: `บันทึกข้อมูลแก้ไขเข้า Google Sheet สำเร็จ`,
          fileUrl: fileUrl,
          fileId: fileId
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ==========================================
    // ACTION 2: UPLOAD_IMAGE (อัปโหลดรูปภาพลง Google Drive และบันทึกข้อมูลเข้า Google Sheet ในขั้นตอนเดียว)
    // ==========================================
    if (data.action === "upload_image" || !data.action) {
      const sheet = getSummonsSheet(spreadsheet);
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

      // บันทึกรูปภาพ (Base64) ลงใน Google Drive Folder (เร็วสูงสุด)
      if (data.imageBase64 && data.fileName) {
        let base64String = data.imageBase64;
        if (base64String.indexOf("base64,") !== -1) {
          base64String = base64String.split("base64,")[1];
        }
        
        const decodedBytes = Utilities.base64Decode(base64String);
        const blob = Utilities.newBlob(decodedBytes, "image/jpeg", data.fileName);
        const createdFile = folder.createFile(blob);
        
        fileId = createdFile.getId();
        fileUrl = createdFile.getUrl();
      }

      // 1. ถ้าเป็นการแทนที่แถวเดิม (Overwrite) -> ค้นหาและอัปเดตเฉพาะแถวเป้าหมาย
      if (data.overwrite) {
        const sheetData = sheet.getDataRange().getValues();
        let targetRowIndex = -1;

        if (data.rowIndex && Number(data.rowIndex) > 1 && Number(data.rowIndex) <= sheetData.length) {
          targetRowIndex = Number(data.rowIndex);
        } else if (data.oldFileId) {
          for (let i = sheetData.length - 1; i >= 1; i--) {
            if (String(sheetData[i][13] || '').trim() === String(data.oldFileId).trim()) {
              targetRowIndex = i + 1;
              break;
            }
          }
        }

        if (targetRowIndex !== -1) {
          // อัปเดตแถวเดิมใน Google Sheet (แทนที่รูปภาพ)
          sheet.getRange(targetRowIndex, 11).setValue(data.fileName || "");
          sheet.getRange(targetRowIndex, 12).setValue(fileUrl);
          sheet.getRange(targetRowIndex, 14).setValue(fileId);
        }
      } else {
        // 2. การเพิ่มข้อมูลใหม่ (New Row) -> appendRow โดยตรงทันที ไม่ต้องโหลดตารางเก่ามาวน Loop (เร็วสูงสุด)
        const timestamp = new Date();
        const thaiDateStr = data.dateTime || Utilities.formatDate(timestamp, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");
        const uploaderUser = data.uploader || data.username || data.uploadedBy || data.user_id || "";

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
          fileId || "",
          uploaderUser
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
    }

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
 * ดึง Google Spreadsheet Object ตาม Spreadsheet ID
 */
function getTargetSpreadsheetFile(folder) {
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
  return spreadsheet;
}

/**
 * ดึงหรือสร้าง Sheet 'บันทึกการส่งหมาย'
 */
function getSummonsSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
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
      "Drive File ID",
      "ผู้บันทึก"
    ];

    sheet.appendRow(headers);
    
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#2563eb");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  } else {
    // ถ้ามี Sheet อยู่แล้ว แต่ยังไม่มีคอลัมน์ผู้บันทึก (คอลัมน์ที่ 15) ให้เพิ่มหัวคอลัมน์
    const lastCol = sheet.getLastColumn();
    if (lastCol < 15) {
      sheet.getRange(1, 15).setValue("ผู้บันทึก");
      sheet.getRange(1, 15).setBackground("#2563eb").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    }
  }

  return sheet;
}

/**
 * ดึงหรือสร้าง Sheet 'users' สำหรับเก็บรายชื่อผู้ใช้งาน
 */
function getUsersSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(USERS_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    const headers = ["username", "password", "role", "name", "createdAt", "courtCategory", "assignedCourt", "assignedProvince"];
    sheet.appendRow(headers);
    
    // สร้างผู้ดูแลระบบตั้งต้น (admin / caogikojt02)
    sheet.appendRow(["admin", "caogikojt02", "admin", "ผู้ดูแลระบบ (Admin)", "25/08/2569", "ศาลจังหวัด", "ศาลจังหวัดอุดรธานี", "อุดรธานี"]);

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#7c3aed");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  } else {
    // อัปเกรดหัวตารางอัตโนมัติหากยังไม่มีคอลัมน์ศาลและจังหวัด
    ensureUsersSheetHeaders(sheet);
  }

  return sheet;
}

function ensureUsersSheetHeaders(sheet) {
  try {
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, Math.max(lastCol, 8)).getValues()[0].map(h => String(h || '').trim()) : [];
    
    let changed = false;
    if (headers.length < 6 || !headers[5]) {
      sheet.getRange(1, 6).setValue("courtCategory");
      changed = true;
    }
    if (headers.length < 7 || !headers[6]) {
      sheet.getRange(1, 7).setValue("assignedCourt");
      changed = true;
    }
    if (headers.length < 8 || !headers[7]) {
      sheet.getRange(1, 8).setValue("assignedProvince");
      changed = true;
    }

    if (changed) {
      const headerRange = sheet.getRange(1, 1, 1, 8);
      headerRange.setBackground("#7c3aed");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
    }
  } catch (err) {
    Logger.log("ensureUsersSheetHeaders error: " + err);
  }
}

/**
 * ดึงหรือสร้าง Sheet 'device_handoff' สำหรับเก็บข้อมูลพิกัดและเส้นทางส่งข้ามอุปกรณ์
 */
function getHandoffSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(HANDOFF_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(HANDOFF_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    const headers = [
      "user_id",
      "queryString",
      "fullAddress",
      "caseNumber",
      "stopsJson",
      "lat",
      "lng",
      "status",
      "timestamp",
      "updated_at"
    ];
    sheet.appendRow(headers);

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#059669");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getTargetSpreadsheet(folder) {
  const ss = getTargetSpreadsheetFile(folder);
  return getSummonsSheet(ss);
}

/**
 * ฟังก์ชันทดสอบการทำงานผ่าน Browser (GET)
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.action === "get_users" || e.parameter.sheet === "users") {
      try {
        const folder = DriveApp.getFolderById(FOLDER_ID);
        const ss = getTargetSpreadsheetFile(folder);
        const uSheet = getUsersSheet(ss);
        const uData = uSheet.getDataRange().getValues();
        const usersList = [];
        for (let i = 1; i < uData.length; i++) {
          if (uData[i][0]) {
            const courtCat = String(uData[i][5] || 'ศาลจังหวัด').trim();
            let courtName = String(uData[i][6] || '').trim();
            const prov = String(uData[i][7] || 'อุดรธานี').trim();
            if (!courtName) {
              if (courtCat === 'ศาลไม่สังกัดภาค') courtName = 'ศาลแพ่ง';
              else if (courtCat === 'ศาลแขวง') courtName = 'ศาลแขวง' + prov;
              else if (courtCat === 'ศาลเยาวชนและครอบครัว') courtName = 'ศาลเยาวชนและครอบครัวจังหวัด' + prov;
              else courtName = 'ศาลจังหวัด' + prov;
            }
            usersList.push({
              username: String(uData[i][0] || '').trim(),
              password: String(uData[i][1] || '').trim(),
              role: String(uData[i][2] || 'user').trim(),
              name: String(uData[i][3] || uData[i][0]).trim(),
              createdAt: String(uData[i][4] || '').trim(),
              courtCategory: courtCat,
              assignedCourt: courtName,
              assignedProvince: prov
            });
          }
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          users: usersList
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: err.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (e.parameter.action === "get_pending_handoff" || e.parameter.action === "get_latest_handoff") {
      try {
        const folder = DriveApp.getFolderById(FOLDER_ID);
        const ss = getTargetSpreadsheetFile(folder);
        const hSheet = getHandoffSheet(ss);
        const targetUserId = String(e.parameter.user_id || e.parameter.username || '').trim().toLowerCase();
        const hData = hSheet.getDataRange().getValues();

        let latestItem = null;
        // Search backwards from the newest row to find the most recent matching record
        for (let i = hData.length - 1; i >= 1; i--) {
          const uId = String(hData[i][0] || '').trim().toLowerCase();
          const status = String(hData[i][7] || '').trim().toLowerCase();
          
          const isUserMatch = !targetUserId || uId === targetUserId || targetUserId === 'admin' || uId === 'admin';
          if (isUserMatch) {
            if (e.parameter.action === "get_pending_handoff" && status !== "pending") {
              continue;
            }
            let parsedStops = [];
            try {
              parsedStops = JSON.parse(hData[i][4] || '[]');
            } catch (pe) {
              parsedStops = [];
            }

            latestItem = {
              user_id: hData[i][0],
              queryString: hData[i][1],
              fullAddress: hData[i][2],
              caseNumber: hData[i][3],
              stops: parsedStops,
              lat: hData[i][5] ? parseFloat(hData[i][5]) : null,
              lng: hData[i][6] ? parseFloat(hData[i][6]) : null,
              status: hData[i][7],
              timestamp: hData[i][8],
              updated_at: hData[i][9]
            };
            break;
          }
        }

        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          hasPending: Boolean(latestItem && latestItem.status === "pending"),
          hasData: Boolean(latestItem),
          handoff: latestItem
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: err.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (e.parameter.action === "get_data" || e.parameter.action === "get_summons") {
      try {
        const folder = DriveApp.getFolderById(FOLDER_ID);
        const ss = getTargetSpreadsheetFile(folder);
        const sheet = getSummonsSheet(ss);
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) {
          return ContentService.createTextOutput(JSON.stringify({
            status: "success",
            data: []
          })).setMimeType(ContentService.MimeType.JSON);
        }
        const headers = data[0];
        const rows = [];
        for (let i = 1; i < data.length; i++) {
          if (!data[i][0] && !data[i][1]) continue;
          const rowObj = {};
          for (let j = 0; j < headers.length; j++) {
            const h = String(headers[j] || '').trim();
            let val = data[i][j];
            if (val instanceof Date) {
              val = Utilities.formatDate(val, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");
            }
            rowObj[h] = val !== undefined && val !== null ? String(val) : '';
          }
          rows.push(rowObj);
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          data: rows
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: err.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "Summons Location Tracking API is running.",
    folderId: FOLDER_ID,
    spreadsheetId: SPREADSHEET_ID
  })).setMimeType(ContentService.MimeType.JSON);
}

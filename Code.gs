/**
 * BACKEND: Multi-Tenant Architecture für Reinigungsplan Versammlung Marburg
 * Rollenbasierter Zugriff, getrennte Spaltenberechtigungen & Kongress-Verwaltung
 */

const CONFIG = {
  PINS: {
    SUPER: "7788",   // Vollzugriff (Super Admin)
    RU_UK: "1122",   // Administrator Russisch/Ukrainisch (Spalten D & E)
    DE: "3344"       // Administrator Deutsch & WE-Hauptreinigung (Spalten F & G)
  },
  ONESIGNAL_APP_ID: "aedd7054-ee01-4e41-b992-5d5a94a4ab4c",
  HEADER_ROWS: 2,
  SHEET_PLAN: "Reinigungsplan",
  SHEET_EVENTS: "Events"
};

/**
 * ROTATION-POOLS FÜR DIE SPRACHGRUPPEN
 */
const ROTATION_POOLS = {
  tuesdaySundayRu: [
    "Marburg 1 - Andrej Tarantasow",
    "Marburg 2 und 3 - Schewchuk & Ashurov",
    "Ukrainisch 1 - Petro Hyliuk",
    "Ukrainisch 2 - Valerij Melnik",
    "Bad Laasphe - Andrej Bauer",
    "Elnhausen - Artur Akopjan",
    "Daniel Engelbrecht - Andrej Bauer"
  ],
  midweekUk: [
    "Ukrainisch 1 - Petro Hyliuk",
    "Ukrainisch 2 - Valerij Melnik",
    "Ortsbedürfnisse",
    "Keine"
  ],
  sundayDe: [
    "1 Eucker, Reinhold",
    "2 Krause Florian",
    "3 Salzbauer Patrick",
    "4 Faupel, Lothar",
    "5 Scherwitzl Oliver",
    "6 Beck Roland",
    "7 Krause Benjamin"
  ],
  weekendMain: [
    "1 Eucker, Reinhold",
    "2 Krause Florian",
    "3 Salzbauer Patrick",
    "4 Faupel, Lothar",
    "5 Scherwitzl Oliver",
    "6 Beck Roland",
    "7 Krause Benjamin",
    "Marburg 1 - Andrej Tarantasow",
    "Marburg 2 und 3 - Schewchuk & Ashurov",
    "Ukrainisch 1 - Petro Hyliuk",
    "Ukrainisch 2 - Valerij Melnik",
    "Bad Laasphe - Andrej Bauer",
    "Elnhausen - Artur Akopjan",
    "Gladenbach - Daniel Engelbrecht"
  ]
};

// ---------------------- HTTP HANDLER (GET / POST) ----------------------

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'get';

    // 1. PIN- und Rollen-Verifizierung
    if (action === 'verify') {
      const pin = e.parameter.pin;
      const role = getRoleByPin(pin);
      return jsonResponse({
        status: role ? "success" : "unauthorized",
        authenticated: !!role,
        role: role
      });
    }

    // 2. Datenabruf
    const schedule = readScheduleFromSheet();
    const events = readEventsFromSheet();

    return jsonResponse({
      status: "success",
      total: schedule.length,
      lastSync: new Date().toISOString(),
      data: schedule,
      events: events
    });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonResponse({ status: "error", message: "Server ist beschäftigt, bitte erneut versuchen" });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", message: "Leere Anfrage" });
    }

    const payload = JSON.parse(e.postData.contents);
    const role = getRoleByPin(payload.pin);

    if (!role) {
      return jsonResponse({ status: "unauthorized", message: "Ungültiger PIN-Code" });
    }

    const action = payload.action;

    // 1. Kongress / Ereignis eintragen
    if (action === 'save_event') {
      saveEventToSheet(payload.event, role);
      applyEventToSchedule(payload.event);
      return jsonResponse({
        status: "success",
        message: "Ereignis erfolgreich gespeichert und im Plan aktualisiert!"
      });
    }

    // 2. Manuelle Planänderungen mit Spalten-Rechteprüfung speichern
    if (action === 'batch_update') {
      writeScheduleWithRoleCheck(payload.data, role);
      return jsonResponse({
        status: "success",
        message: "Plan erfolgreich in Google Sheets gespeichert!"
      });
    }

    // 3. Rollenbasierte Auto-Rotation
    if (action === 'auto_rotate') {
      return handleScopedAutoRotation(payload, role);
    }

    return jsonResponse({ status: "error", message: `Unbekannte Aktion: ${action}` });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------- ROLLEN & BERECHTIGUNGEN ----------------------

function getRoleByPin(pin) {
  if (pin === CONFIG.PINS.SUPER) return 'SUPER_ADMIN';
  if (pin === CONFIG.PINS.RU_UK) return 'ADMIN_RU_UK';
  if (pin === CONFIG.PINS.DE) return 'ADMIN_DE';
  return null;
}

// ---------------------- EVENTS & KONGRESSE ----------------------

function getEventsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_EVENTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_EVENTS);
    sheet.appendRow(["KW", "Scope (DE/RU/UK/ALL)", "Event Title", "Target Column", "Created By", "Timestamp"]);
    sheet.getRange(1, 1, 1, 6).setBackground("#4338ca").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readEventsFromSheet() {
  const sheet = getEventsSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  return values.slice(1).map(row => ({
    kw: String(row[0]).trim(),
    scope: String(row[1]).trim(),
    title: String(row[2]).trim(),
    targetColumn: String(row[3] || 'ALL').trim(),
    createdBy: String(row[4] || '').trim()
  }));
}

function saveEventToSheet(eventData, role) {
  const sheet = getEventsSheet();
  sheet.appendRow([
    eventData.kw,
    eventData.scope,
    eventData.title,
    eventData.targetColumn || "ALL",
    role,
    new Date().toISOString()
  ]);
}

function applyEventToSchedule(eventData) {
  const planSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_PLAN);
  if (!planSheet) return;
  
  const values = planSheet.getDataRange().getValues();
  
  for (let i = CONFIG.HEADER_ROWS; i < values.length; i++) {
    const rowKw = String(values[i][0]).trim();
    if (rowKw === eventData.kw) {
      const rowIndex = i + 1;
      
      // Spalten: 4=RU (D), 5=UK (E), 6=DE (F), 7=WE (G)
      if (eventData.scope === 'RU') {
        planSheet.getRange(rowIndex, 4).setValue(eventData.title);
      } else if (eventData.scope === 'UK') {
        planSheet.getRange(rowIndex, 5).setValue(eventData.title);
      } else if (eventData.scope === 'DE') {
        planSheet.getRange(rowIndex, 6).setValue(eventData.title);
        planSheet.getRange(rowIndex, 7).setValue(eventData.title);
      } else if (eventData.scope === 'ALL') {
        planSheet.getRange(rowIndex, 4, 1, 4).setValues([
          [eventData.title, eventData.title, eventData.title, eventData.title]
        ]);
      }
      break;
    }
  }
}

// ---------------------- PLAN SPEICHERN MIT SPALTEN-ISOLATION ----------------------

function writeScheduleWithRoleCheck(scheduleArray, role) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_PLAN) || ss.getSheets()[0];
  const headerOffset = CONFIG.HEADER_ROWS;

  scheduleArray.forEach((item, idx) => {
    const targetRow = idx + headerOffset + 1;
    
    if (role === 'SUPER_ADMIN') {
      sheet.getRange(targetRow, 1, 1, 7).setValues([[
        cleanStr(item.kw),
        formatDate(item.fromDate),
        formatDate(item.toDate),
        cleanStr(item.tuesdaySundayRu),
        cleanStr(item.midweekUk),
        cleanStr(item.sundayDe),
        cleanStr(item.weekendMain)
      ]]);
    } else if (role === 'ADMIN_RU_UK') {
      // RU/UK darf nur die Spalten 4 und 5 (D & E) überschreiben
      sheet.getRange(targetRow, 4, 1, 2).setValues([[
        cleanStr(item.tuesdaySundayRu),
        cleanStr(item.midweekUk)
      ]]);
    } else if (role === 'ADMIN_DE') {
      // DE darf nur die Spalten 6 und 7 (F & G) überschreiben
      sheet.getRange(targetRow, 6, 1, 2).setValues([[
        cleanStr(item.sundayDe),
        cleanStr(item.weekendMain)
      ]]);
    }
  });
}

// ---------------------- GETRENNTE & FAIRE AUTO-ROTATION ----------------------

function handleScopedAutoRotation(payload, role) {
  const startKw = payload.startKw ? parseInt(payload.startKw, 10) : 26;
  const totalWeeks = payload.totalWeeks ? parseInt(payload.totalWeeks, 10) : 28;
  const startDate = payload.startDate ? new Date(payload.startDate) : new Date(2026, 5, 22);
  const scope = payload.scope || (role === 'ADMIN_DE' ? 'DE' : (role === 'ADMIN_RU_UK' ? 'RU_UK' : 'ALL'));
  const firstWeekJoint = payload.firstWeekJoint !== false; // default true
  const fairQueue = payload.fairQueue !== false; // default true

  const existingSchedule = readScheduleFromSheet();
  const events = readEventsFromSheet();

  let ruQueueIndex = 0;
  let ukQueueIndex = 0;
  let deQueueIndex = 0;
  let mainQueueIndex = 0;

  const custom = payload.customPools || {};
  const ruPool = (custom.tuesdaySundayRu && custom.tuesdaySundayRu.length) ? custom.tuesdaySundayRu : ROTATION_POOLS.tuesdaySundayRu;
  const ukPool = (custom.midweekUk && custom.midweekUk.length) ? custom.midweekUk : ROTATION_POOLS.midweekUk;
  const dePool = (custom.sundayDe && custom.sundayDe.length) ? custom.sundayDe : ROTATION_POOLS.sundayDe;
  const mainPool = (custom.weekendMain && custom.weekendMain.length) ? custom.weekendMain : (custom.sundayDe || ROTATION_POOLS.weekendMain);

  const currentMonday = new Date(startDate);
  const updatedSchedule = [];

  for (let i = 0; i < totalWeeks; i++) {
    const kwNumber = startKw + i;
    const kwLabel = `KW ${kwNumber}`;
    const fromStr = formatShortDate(currentMonday);
    const sundayDate = new Date(currentMonday);
    sundayDate.setDate(currentMonday.getDate() + 6);
    const toStr = formatShortDate(sundayDate);

    // Prüfen, ob dies die 1. Woche im Monat ist (Sonntag liegt zwischen 1. und 7. oder Dienstag <= 7)
    const tuesdayDate = new Date(currentMonday);
    tuesdayDate.setDate(currentMonday.getDate() + 1);
    const isFirstWeek = (tuesdayDate.getDate() <= 7 || sundayDate.getDate() <= 7);

    // Bestehenden Eintrag suchen
    const existing = existingSchedule.find(s => s.kw === kwLabel) || {};

    // Kongress-Ereignisse für diese KW prüfen
    const weekEvents = events.filter(e => e.kw === kwLabel);
    const ruEvent = weekEvents.find(e => e.scope === 'RU' || e.scope === 'ALL');
    const ukEvent = weekEvents.find(e => e.scope === 'UK' || e.scope === 'ALL');
    const deEvent = weekEvents.find(e => e.scope === 'DE' || e.scope === 'ALL');

    let ruAssignee = existing.tuesdaySundayRu || '';
    let ukAssignee = existing.midweekUk || '';
    let deAssignee = existing.sundayDe || '';
    let mainAssignee = existing.weekendMain || '';

    // 1. Rotation für Russisch (Di & So)
    if (scope === 'RU_UK' || scope === 'ALL') {
      if (ruEvent) {
        ruAssignee = ruEvent.title;
        if (!fairQueue) ruQueueIndex++;
      } else {
        ruAssignee = ruPool[ruQueueIndex % ruPool.length];
        ruQueueIndex++;
      }

      // 2. Rotation für Ukrainisch (Mi & Do)
      if (ukEvent) {
        ukAssignee = ukEvent.title;
        if (!fairQueue) ukQueueIndex++;
      } else if (firstWeekJoint && isFirstWeek) {
        // Am Monatsanfang treffen sich RU & UK gemeinsam -> Mi & Do entfällt
        ukAssignee = 'Keine';
      } else {
        ukAssignee = ukPool[ukQueueIndex % ukPool.length];
        ukQueueIndex++;
      }
    }

    // 3. Rotation für Deutsch (So & WE Hauptreinigung)
    if (scope === 'DE' || scope === 'ALL') {
      if (deEvent) {
        deAssignee = deEvent.title;
        mainAssignee = deEvent.title;
        if (!fairQueue) {
          deQueueIndex++;
          mainQueueIndex++;
        }
      } else {
        deAssignee = dePool[deQueueIndex % dePool.length];
        deQueueIndex++;
        mainAssignee = mainPool[mainQueueIndex % mainPool.length];
        mainQueueIndex++;
      }
    }

    updatedSchedule.push({
      id: i + 1,
      kw: kwLabel,
      kwNumber: kwNumber,
      fromDate: existing.fromDate || fromStr,
      toDate: existing.toDate || toStr,
      tuesdaySundayRu: ruAssignee,
      midweekUk: ukAssignee,
      sundayDe: deAssignee,
      weekendMain: mainAssignee
    });

    currentMonday.setDate(currentMonday.getDate() + 7);
  }

  writeScheduleWithRoleCheck(updatedSchedule, role);

  return jsonResponse({
    status: "success",
    message: `Faire Rotation (${scope}) erfolgreich generiert und gespeichert!`,
    total: updatedSchedule.length,
    data: updatedSchedule
  });
}

// ---------------------- HILFSFUNKTIONEN ----------------------

function readScheduleFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_PLAN) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length <= CONFIG.HEADER_ROWS) return [];

  return values.slice(CONFIG.HEADER_ROWS)
    .filter(row => row && row[0] !== undefined && String(row[0]).trim() !== '')
    .map((row, idx) => ({
      id: idx + 1,
      kw: cleanStr(row[0]),
      kwNumber: (String(row[0]).match(/\d+/) || [0])[0] * 1,
      fromDate: formatDate(row[1]),
      toDate: formatDate(row[2]),
      tuesdaySundayRu: cleanStr(row[3]),
      midweekUk: cleanStr(row[4]),
      sundayDe: cleanStr(row[5]),
      weekendMain: cleanStr(row[6])
    }));
}

function cleanStr(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[\u00A0\u200B\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return `${d}.${m}.`;
  }
  let str = cleanStr(val);
  if (/^\d{1,2}\.\d{1,2}$/.test(str)) str += '.';
  return str;
}

function formatShortDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.`;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------- ONESIGNAL PUSH NOTIFICATIONS ----------------------

/**
 * Sendet eine gezielte Push-Benachrichtigung an eine bestimmte Gruppe über OneSignal
 * @param {string} groupName - Name der Gruppe (z.B. "Marburg 1", "Ukrainisch 1")
 * @param {string} title - Titel der Benachrichtigung
 * @param {string} message - Text der Benachrichtigung
 * @param {string} restApiKey - Optional: OneSignal REST API Key (unter OneSignal -> Settings -> Keys & IDs)
 */
function sendOneSignalPushToGroup(groupName, title, message, restApiKey) {
  if (!CONFIG.ONESIGNAL_APP_ID || !groupName) return;
  const apiKey = restApiKey || PropertiesService.getScriptProperties().getProperty('ONESIGNAL_REST_API_KEY');
  if (!apiKey) {
    Logger.log("ONESIGNAL_REST_API_KEY nicht in Script Properties hinterlegt.");
    return;
  }

  const payload = {
    app_id: CONFIG.ONESIGNAL_APP_ID,
    filters: [
      { field: "tag", key: "cleaning_group", relation: "=", value: groupName }
    ],
    headings: { en: title, de: title, ru: title, uk: title },
    contents: { en: message, de: message, ru: message, uk: message },
    url: "https://reinigungsplan-versammlung-marburg.vercel.app/"
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Basic " + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch("https://onesignal.com/api/v1/notifications", options);
    Logger.log("OneSignal Response: " + response.getContentText());
    return JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log("OneSignal Error: " + err);
  }
}

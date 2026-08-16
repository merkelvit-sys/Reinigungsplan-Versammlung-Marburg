/**
 * Google Apps Script Backend für "Reinigungsplan Versammlung Marburg"
 * 
 * Einsatz:
 * 1. Im Google Sheet: Erweiterungen > Apps Script
 * 2. Diesen Code einfügen
 * 3. Bereitstellen > Neue Bereitstellung > Web-App
 *    - Ausführen als: "Ich" (Owner)
 *    - Zugriff: "Jeder" (Anyone)
 */

function doGet(e) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getActiveSheet();
    const range = sheet.getDataRange();
    const values = range.getValues();

    if (!values || values.length < 3) {
      return createJsonResponse({
        status: "success",
        data: [],
        meta: { message: "Tabelle enthält keine Datenzeilen" }
      });
    }

    // Überspringen der ersten 2 Kopfzeilen
    const rawRows = values.slice(2);

    const schedule = rawRows
      .filter(row => row && row[0] !== undefined && String(row[0]).trim() !== '')
      .map((row, index) => {
        const kwRaw = cleanString(row[0]);
        // Extrahiere numerische Kalenderwoche für schnellen Abgleich
        const kwNumberMatch = kwRaw.match(/\d+/);
        const kwNumber = kwNumberMatch ? parseInt(kwNumberMatch[0], 10) : null;

        return {
          id: index + 1,
          kw: kwRaw,
          kwNumber: kwNumber,
          fromDate: cleanDateString(row[1]),
          toDate: cleanDateString(row[2]),
          tuesdaySundayRu: cleanString(row[3]),
          midweekUk: cleanString(row[4]),
          sundayDe: cleanString(row[5]),
          weekendMain: cleanString(row[6])
        };
      });

    return createJsonResponse({
      status: "success",
      meta: {
        totalWeeks: schedule.length,
        lastUpdated: new Date().toISOString()
      },
      data: schedule
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString(),
      stack: error.stack
    }, 500);
  }
}

/**
 * Bereinigt String-Werte von typischen OCR-Artefakten und Normalisierungsfehlern
 */
function cleanString(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  
  return str
    // Entfernt unerwünschte OCR-Klammern und Doppelpunkte in Wörtern (z.B. "Ukrai) (nisch" -> "Ukrainisch")
    .replace(/[\)\(:]/g, '')
    // Ersetzt mehrfache Leerzeichen, geschützte Leerzeichen und Tabs durch ein einzelnes Leerzeichen
    .replace(/[\s\u00A0\u200B]+/g, ' ')
    .trim();
}

/**
 * Normalisiert Datumsangaben (z.B. Date-Objekte aus Sheets oder rohe Strings)
 */
function cleanDateString(val) {
  if (val === null || val === undefined) return '';
  
  if (val instanceof Date) {
    const day = String(val.getDate()).padStart(2, '0');
    const month = String(val.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.`;
  }

  let str = cleanString(val);
  // Stellt sicher, dass Punkte nach Zahlen vorhanden sind (z.B. "05.01" -> "05.01.")
  if (/^\d{1,2}\.\d{1,2}$/.test(str)) {
    str += '.';
  }
  return str;
}

/**
 * Hilfsfunktion zum Erstellen der JSON-Antwort mit korrekten Headern
 */
function createJsonResponse(data) {
  const jsonString = JSON.stringify(data);
  return ContentService.createTextOutput(jsonString)
    .setMimeType(ContentService.MimeType.JSON);
}

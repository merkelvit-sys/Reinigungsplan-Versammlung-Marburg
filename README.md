# Reinigungsplan Versammlung Marburg

Ein modernes, leichtgewichtiges und blitzschnelles Single-Page-Portal (SPA) zur Anzeige und Durchsuchung des Reinigungsplans der Versammlung Marburg.

---

## 🏗 Architektur

```
┌───────────────────────────┐         ┌──────────────────────────────┐         ┌──────────────────────────────┐
│       Google Sheets       │ ──────> │  Google Apps Script (API)    │ ──────> │     Vercel Frontend (SPA)    │
│  (Admin Datenpflege / DB) │         │ (JSON REST API & OCR-Filter) │         │ (HTML5 / Tailwind / Vanilla) │
└───────────────────────────┘         └──────────────────────────────┘         └──────────────────────────────┘
```

- **Backend / Datenspeicher:** Google Sheets mit automatischem Apps Script Web-App Endpunkt.
- **Frontend:** Statische Web-App (HTML5, Tailwind CSS, Vanilla JS) ohne Build-Overhead.
- **Hosting:** Optimiert für Vercel, GitHub Pages oder jeden statischen Webserver.

---

## 🚀 Schnelleinrichtung

### 1. Backend (Google Sheets & Apps Script)
1. Öffne deine Google Sheets Tabelle mit dem Reinigungsplan.
2. Klicke im oberen Menü auf **Erweiterungen > Apps Script**.
3. Ersetze den gesamten Code durch den Inhalt der Datei [`Code.gs`](file:///c:/Users/vital/Desktop/Reinigungsplan%20Versammlung%20Marburg/Code.gs).
4. Klicke oben rechts auf **Bereitstellen > Neue Bereitstellung**.
5. Wähle den Typ **Web-App**:
   - **Beschreibung:** `Reinigungsplan API v1`
   - **Ausführen als:** `Ich (deine-email@gmail.com)`
   - **Wer hat Zugriff:** `Jeder` *(Wichtig, damit das Frontend ohne Login Daten abrufen kann)*
6. Klicke auf **Bereitstellen** und kopiere die generierte **Web-App-URL** (endet auf `/exec`).

---

### 2. Frontend anpassen & Deployen
1. Öffne [`index.html`](file:///c:/Users/vital/Desktop/Reinigungsplan%20Versammlung%20Marburg/index.html).
2. Ersetze in Zeile `155` den Platzhalter `DEINE_APPS_SCRIPT_WEB_APP_URL` durch deine kopierte Apps Script URL:
   ```javascript
   const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx.../exec';
   ```
3. Verbinde dein GitHub-Repository mit [Vercel](https://vercel.com) und deploye das Root-Verzeichnis mit einem Klick.

---

## ✨ Features
- ⚡ **Offline-First Caching:** Daten werden in `localStorage` gecacht und sofort geladen.
- 🎯 **Automatische Kalenderwochen-Erkennung:** Findet anhand der ISO-8601 Norm die aktuelle Woche (`KW XX`), hebt diese farblich hervor und scrollt automatisch dorthin.
- 🔍 **Echtzeit-Suche:** Sofortiges Filtern nach Namen, Gruppen, Kalenderwochen oder Datum.
- 📱 **Adaptive UI:** Schöne Tabelle auf Desktop-Monitoren, übersichtliche Kartenansicht auf Smartphones.
- 🖨 **Druck- & PDF-Unterstützung:** Dediziertes CSS für saubere Ausdrucke am Schwarzen Brett.
- 🛡 **XSS-Schutz:** Sicheres Rendern von Zellinhalten durch HTML-Sanitization.

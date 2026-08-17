/* ============================================================
   Heute im Dienst — Real-time "Who is cleaning today" widget
   Integrates with global scheduleData / currentCalculatedKW.
   Triggered by the 'reinigungsplan:rendered' event (from render()),
   with a polling fallback so no index.html edit is strictly required.

   Robustness:
   - Tolerant to BOTH key naming schemes: ru/uk/de/deSo/main
     AND tuesdaySundayRu/midweekUk/sundayDe/weekendMain.
   - Day->Column map is BUILT from the single source of truth
     (window.ReinigungsplanConfig.getMeetingDays()), so it stays
     correct even when an admin changes the meeting days. Falls back
     to a static hash if the config is unavailable.
   - Always visible: on a no-cleaning day (Mo/Fr) or when the current
     week is not in the data yet, it shows the NEXT upcoming service
     with its real weekday name + a relative countdown.
   ============================================================ */
(function () {
  'use strict';

  // JS getDay(): 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa
  // Static fallback (mirrors DEFAULT_MEETING_DAYS: Di/RU, Mi/UK, Do/DE,
  // So+Sa/Hauptreinigung, So also carries deSo). Used only if the live
  // config cannot be read.
  const FALLBACK_DAY_MAP = {
    0: ['ru', 'uk', 'deSo', 'main'], // Sonntag
    2: ['ru'],                        // Dienstag
    3: ['uk'],                        // Mittwoch
    4: ['de'],                        // Donnerstag
    6: ['main']                       // Samstag (WE-Hauptreinigung)
  };

  // Canonical column -> list of accepted raw keys (old + new naming)
  const KEY_ALIASES = {
    ru:   ['ru', 'tuesdaySundayRu'],
    uk:   ['uk', 'midweekUk'],
    de:   ['de', 'thursdayDe'],
    deSo: ['deSo', 'sundayDe'],
    main: ['main', 'weekendMain']
  };

  const TYPE_LABEL = {
    ru:    { short: 'Zwischenreinigung', lang: 'Russisch (Di & So)', icon: 'fa-flag' },
    uk:    { short: 'Zwischenreinigung', lang: 'Ukrainisch (Mi & So)', icon: 'fa-flag' },
    de:    { short: 'Zwischenreinigung', lang: 'Deutsch (Do)', icon: 'fa-flag' },
    deSo:  { short: 'Zwischenreinigung', lang: 'Deutsch (So)', icon: 'fa-flag' },
    main:  { short: 'Hauptreinigung',    lang: 'Wochenende', icon: 'fa-broom' }
  };

  const WEEKDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const SKIP = /kongress|keine|aufseher/i;
  const DAY_CODE_TO_GETDAY = { Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6, So: 0 };

  function el(id) { return document.getElementById(id); }

  function showToast(msg) {
    const t = el('toast'), m = el('toastMessage');
    if (!t || !m) return;
    m.textContent = msg; t.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getLang() {
    return (window.currentLang) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('reinigungsplan_lang')) ||
      'de';
  }

  // i18n for the Hero widget copy
  const I18N = {
    de: {
      badge: 'Heute im Dienst',
      noService: 'Heute keine Reinigung.',
      nextService: 'Nächster Dienst',
      tomorrow: 'morgen',
      inDays: (n) => `in ${n} Tagen`,
      remind: 'Erinnern',
      pin: 'Anheften'
    },
    ru: {
      badge: 'Сегодня дежурство',
      noService: 'Сегодня уборки нет.',
      nextService: 'Следующая уборка',
      tomorrow: 'завтра',
      inDays: (n) => `через ${n} дн.`,
      remind: 'Напомнить',
      pin: 'Закрепить'
    },
    uk: {
      badge: "Сьогодні прибирання",
      noService: "Сьогодні прибирання немає.",
      nextService: "Наступне прибирання",
      tomorrow: "завтра",
      inDays: (n) => `через ${n} дн.`,
      remind: "Нагадати",
      pin: "Закріпити"
    }
  };
  function i18n() { return I18N[getLang()] || I18N.de; }

  const LOC = { de: 'de-DE', ru: 'ru-RU', uk: 'uk-UA' };
  function weekdayLong(date, lang) {
    const loc = LOC[lang] || 'de-DE';
    let w = date.toLocaleDateString(loc, { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  // Read a column value, tolerant to both key naming schemes
  function getCell(item, key) {
    if (!item) return '';
    const candidates = KEY_ALIASES[key] || [key];
    for (const k of candidates) {
      const v = item[k];
      if (v != null && String(v).trim() !== '') return v;
    }
    return '';
  }

  // Parse dd.mm.yyyy
  function parseDEDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!m) return null;
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }

  function currentWeekNumber(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const firstDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
    return 1 + Math.round((t - firstThursday) / (7 * 864e5));
  }

  function getData() {
    return (typeof scheduleData !== 'undefined' && Array.isArray(scheduleData)) ? scheduleData : [];
  }

  // Build the reverse day->column map from the live meetingDays config.
  function buildDayMap() {
    const cfg = (window.ReinigungsplanConfig && typeof window.ReinigungsplanConfig.getMeetingDays === 'function')
      ? window.ReinigungsplanConfig.getMeetingDays()
      : null;
    if (!cfg) return cloneMap(FALLBACK_DAY_MAP);

    const map = {};
    const add = (code, col) => {
      if (!code || code === '-') return;
      const d = DAY_CODE_TO_GETDAY[code];
      if (d === undefined) return;
      (map[d] = map[d] || []).push(col);
    };

    add(cfg.ru.midweek, 'ru'); add(cfg.ru.weekend, 'ru');
    add(cfg.uk.midweek, 'uk'); add(cfg.uk.weekend, 'uk');
    add(cfg.de.midweek, 'de');
    if (cfg.de.weekend && cfg.de.weekend !== '-') {
      add(cfg.de.weekend, 'de');
      add(cfg.de.weekend, 'deSo'); // Deutsche So-Zwischenreinigung
    }
    // Hauptreinigung am Wochenende (Samstag & Sonntag)
    add('Sa', 'main'); add('So', 'main');
    return map;
  }
  function cloneMap(m) {
    const out = {};
    Object.keys(m).forEach(k => { out[k] = m[k].slice(); });
    return out;
  }

  // Resolve the row for "this week": exact kwNumber, else by date range, else null
  function findCurrentWeek() {
    const kw = (typeof currentCalculatedKW !== 'undefined' && currentCalculatedKW)
      || currentWeekNumber(new Date());
    const data = getData();
    let exact = data.find(d => d.kwNumber === kw);
    if (exact) return exact;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    let byDate = data.find(d => {
      const from = parseDEDate(d.fromDate), to = parseDEDate(d.toDate);
      if (!from || !to) return false;
      return today >= from && today <= to;
    });
    if (byDate) return byDate;
    return null;
  }

  // The very next cleaning occurrence strictly AFTER `now` across the
  // current and upcoming weeks, derived from the day->column map.
  function nextCleaningAfter(now) {
    const data = getData();
    const dayMap = buildDayMap();
    const startKw = (typeof currentCalculatedKW !== 'undefined' && currentCalculatedKW)
      ? currentCalculatedKW - 1 : currentWeekNumber(now) - 1;

    const weeks = data
      .filter(d => (d.kwNumber || 0) >= startKw)
      .sort((a, b) => (a.kwNumber || 0) - (b.kwNumber || 0));

    const candidates = [];
    for (const item of weeks) {
      const monday = parseDEDate(item.fromDate);
      if (!monday) continue;
      for (let w = 0; w < 7; w++) {
        const cols = dayMap[w] || [];
        for (const c of cols) {
          const name = getCell(item, c);
          if (!name || SKIP.test(name)) continue;
          const offset = (w - 1 + 7) % 7; // Mo=0 .. So=6
          const d = new Date(monday);
          d.setDate(d.getDate() + offset);
          d.setHours(12, 0, 0, 0);
          if (d > now) candidates.push({ date: d, col: c, name: name, item: item });
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.date - b.date);
    return candidates[0];
  }

  function renderToday() {
    const b = ensureBanner();
    const now = new Date();
    const dow = now.getDay();
    const week = findCurrentWeek();
    const dayMap = buildDayMap();
    const cols = dayMap[dow] || [];
    const services = week
      ? cols.map(c => ({ col: c, name: getCell(week, c) }))
            .filter(s => s.name && !SKIP.test(s.name))
      : [];

    const T = i18n();

    // Active cleaning day -> neon gradient badge
    if (week && services.length) {
      const primary = services[0];
      const meta = TYPE_LABEL[primary.col];
      const extra = services.slice(1).map(s => escapeHtml(getCell(week, s.col))).join(' · ');
      b.className = 'bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-cyan-500 text-white shadow-lg';
      b.innerHTML = `
        <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div class="shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
            <i class="fa-solid ${meta.icon} text-lg"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[10px] uppercase tracking-widest font-bold text-white/80 flex items-center gap-2">
              <span>${WEEKDAY_DE[dow]} • ${escapeHtml(T.badge)}</span>
              <span class="bg-white/20 px-1.5 py-0.5 rounded">${escapeHtml(meta.short)}</span>
            </div>
            <div class="text-base sm:text-lg font-black truncate leading-tight">${escapeHtml(primary.name)}</div>
            ${extra ? `<div class="text-[11px] text-white/80 truncate">${extra}</div>` : ''}
          </div>
          <button onclick="HeuteImDienst.remind()"
            class="shrink-0 px-3 py-2 min-h-[44px] bg-white/15 hover:bg-white/30 active:bg-white/40 rounded-xl text-xs font-bold border border-white/30 transition flex items-center gap-1.5">
            <i class="fa-solid fa-bell"></i><span class="hidden sm:inline">${escapeHtml(T.remind)}</span>
          </button>
        </div>`;
      b.classList.remove('hidden');
      return;
    }

    // No cleaning today -> always show the NEXT upcoming service with its
    // real weekday name + relative countdown (Zero-Service State).
    const next = nextCleaningAfter(now);
    let label;
    if (next) {
      const days = Math.ceil((next.date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
      const rel = days <= 1 ? T.tomorrow : T.inDays(days);
      const wd = weekdayLong(next.date, getLang());
      label = `${T.nextService}: <b>${escapeHtml(wd)} (${escapeHtml(next.name)})</b> · ${escapeHtml(rel)} <span class="opacity-70">(${escapeHtml(next.item.kw)})</span>`;
    } else {
      label = 'Keine weiteren Termine geplant.';
    }
    b.className = 'bg-slate-800 text-slate-200 border-b border-slate-700';
    b.innerHTML = `
      <div class="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3 text-sm">
        <i class="fa-solid fa-moon text-indigo-300"></i>
        <span class="flex-1 min-w-0">${escapeHtml(T.noService)} ${label}</span>
      </div>`;
    b.classList.remove('hidden');
  }

  // Build banner ONCE with reserved height -> no layout shift later.
  // Prefers the static placeholder in index.html (first-screen, no JS race).
  function ensureBanner() {
    let b = el('heuteImDienst');
    if (b) return b;
    b = document.createElement('section');
    b.id = 'heuteImDienst';
    b.className = 'hidden';
    b.style.minHeight = '56px';
    const anchor = el('personalBanner') || el('filterChipsBar') || el('main');
    (anchor || document.body).before(b);
    return b;
  }

  function update() { renderToday(); }

  // Quick reminder: Notification API + in-app toast fallback
  function remind() {
    const week = findCurrentWeek();
    const name = week ? (getCell(week, 'ru') || getCell(week, 'uk') || getCell(week, 'de') || getCell(week, 'main')) : '';
    const msg = name ? `Erinnerung: Heute Reinigung – ${name}` : 'Reinigung heute';
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Reinigungsplan Marburg', { body: msg });
      } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
          if (p === 'granted') new Notification('Reinigungsplan Marburg', { body: msg });
          else showToast('Erinnerung: ' + msg);
        });
      } else {
        showToast('Erinnerung: ' + msg);
      }
    } catch (e) { showToast('Erinnerung: ' + msg); }
  }

  document.addEventListener('reinigungsplan:rendered', update);
  document.addEventListener('DOMContentLoaded', () => { ensureBanner(); update(); });

  // Safety net: poll until scheduleData appears (no index.html edit needed)
  if (typeof scheduleData === 'undefined') {
    let tries = 0;
    const iv = setInterval(() => {
      if (typeof scheduleData !== 'undefined' || ++tries > 60) { clearInterval(iv); update(); }
    }, 300);
  } else {
    update();
  }
  // Keep "today" fresh across midnight
  setInterval(update, 60 * 1000);

  window.HeuteImDienst = { update, remind, renderToday, getCell };
})();

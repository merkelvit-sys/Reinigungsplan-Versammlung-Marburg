/* ============================================================
   Heute im Dienst — Real-time "Who is cleaning today" widget
   Integrates with global scheduleData / currentCalculatedKW.
   Triggered by the 'reinigungsplan:rendered' event (from render()),
   with a polling fallback so no index.html edit is strictly required.
   ============================================================ */
(function () {
  'use strict';

  // JS getDay(): 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa
  // Column mapping (index.html:383-389 / Code.gs:9-12):
  //   Di -> ru (Di & So, Russisch)
  //   Mi -> uk (Mi & So, Ukrainisch)
  //   Do -> de (Deutsch)
  //   So -> ru, uk, deSo (all share Sunday) + main (Hauptreinigung WE)
  //   Sa -> main (Hauptreinigung WE)
  const DAY_MAP = {
    0: ['ru', 'uk', 'deSo', 'main'], // Sonntag
    2: ['ru'],                        // Dienstag
    3: ['uk'],                        // Mittwoch
    4: ['de'],                        // Donnerstag
    6: ['main']                       // Samstag (WE-Hauptreinigung)
  };

  const TYPE_LABEL = {
    ru:    { short: 'Zwischenreinigung', lang: 'Russisch (Di & So)', icon: 'fa-flag' },
    uk:    { short: 'Zwischenreinigung', lang: 'Ukrainisch (Mi & So)', icon: 'fa-flag' },
    de:    { short: 'Zwischenreinigung', lang: 'Deutsch (Do)', icon: 'fa-flag' },
    deSo:  { short: 'Zwischenreinigung', lang: 'Deutsch (So)', icon: 'fa-flag' },
    main:  { short: 'Hauptreinigung',    lang: 'Wochenende', icon: 'fa-broom' }
  };

  const WEEKDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

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

  // Build banner ONCE with reserved height -> no layout shift later
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

  function currentWeekNumber(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const firstDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
    return 1 + Math.round((t - firstThursday) / (7 * 864e5));
  }

  function findCurrentWeek() {
    const kw = (typeof currentCalculatedKW !== 'undefined' && currentCalculatedKW)
      || currentWeekNumber(new Date());
    const data = (typeof scheduleData !== 'undefined' && scheduleData) || [];
    return data.find(d => d.kwNumber === kw) || null;
  }

  function findNextService(week) {
    const data = (typeof scheduleData !== 'undefined' && scheduleData) || [];
    const cols = ['main', 'ru', 'uk', 'de', 'deSo'];
    for (const item of data) {
      if (item.kwNumber <= (week ? week.kwNumber : 0)) continue;
      for (const c of cols) {
        if (item[c] && !/kongress|keine|aufseher/i.test(item[c])) {
          return { item, col: c };
        }
      }
    }
    return null;
  }

  function renderToday() {
    const b = ensureBanner();
    const now = new Date();
    const dow = now.getDay();
    const week = findCurrentWeek();

    if (!week) { b.classList.add('hidden'); return; }

    const cols = DAY_MAP[dow] || [];
    const services = cols
      .map(c => ({ col: c, name: week[c] }))
      .filter(s => s.name && !/kongress|keine|aufseher/i.test(s.name));

    if (dow === 1 || dow === 5 || services.length === 0) {
      const next = findNextService(week);
      const label = next
        ? `Nächster Dienst: <b>${escapeHtml(TYPE_LABEL[next.col].lang)}</b> – ${escapeHtml(next.item[next.col])} <span class="opacity-70">(${escapeHtml(next.item.kw)})</span>`
        : 'Keine weiteren Termine geplant.';
      b.className = 'bg-slate-800 text-slate-200 border-b border-slate-700';
      b.innerHTML = `
        <div class="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3 text-sm">
          <i class="fa-solid fa-moon text-indigo-300"></i>
          <span>Heute keine Reinigung. ${label}</span>
        </div>`;
      b.classList.remove('hidden');
      return;
    }

    const primary = services[0];
    const meta = TYPE_LABEL[primary.col];
    const extra = services.slice(1).map(s => escapeHtml(week[s.col])).join(' · ');
    b.className = 'bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-cyan-500 text-white shadow-lg';
    b.innerHTML = `
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <div class="shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
          <i class="fa-solid ${meta.icon} text-lg"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] uppercase tracking-widest font-bold text-white/80 flex items-center gap-2">
            <span>${WEEKDAY_DE[dow]} • Heute im Dienst</span>
            <span class="bg-white/20 px-1.5 py-0.5 rounded">${escapeHtml(meta.short)}</span>
          </div>
          <div class="text-base sm:text-lg font-black truncate leading-tight">${escapeHtml(primary.name)}</div>
          ${extra ? `<div class="text-[11px] text-white/80 truncate">${extra}</div>` : ''}
        </div>
        <button onclick="HeuteImDienst.remind()"
          class="shrink-0 px-3 py-2 min-h-[44px] bg-white/15 hover:bg-white/30 active:bg-white/40 rounded-xl text-xs font-bold border border-white/30 transition flex items-center gap-1.5">
          <i class="fa-solid fa-bell"></i><span class="hidden sm:inline">Erinnern</span>
        </button>
      </div>`;
    b.classList.remove('hidden');
  }

  function update() { renderToday(); }

  // Public quick-reminder: Notification API + in-app toast fallback
  function remind() {
    const week = findCurrentWeek();
    const msg = week ? `Erinnerung: Heute Reinigung – ${week.ru || week.uk || week.de || week.main || ''}` : 'Reinigung heute';
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

  window.HeuteImDienst = { update, remind, renderToday };
})();

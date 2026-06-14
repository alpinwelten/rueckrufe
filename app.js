/* ============================================================
   Rückruf-Radar – app.js
   Build-freie Vanilla-JS-PWA (ES-Modul).
   Lädt ./data/recalls.json, rendert Statistik, Filter und Karten.

   SICHERHEIT: Rückrufdaten stammen aus externen Quellen. Es wird
   ausschließlich textContent / createElement verwendet – niemals
   roher innerHTML mit Fremddaten. URLs werden vor Verwendung auf
   http/https geprüft (sicherUrl).
   ============================================================ */

'use strict';

/* ---------- Konfiguration / Konstanten ---------- */

const DATA_URL = './data/recalls.json';

// Kategorien in fester Reihenfolge (für Chips + Statistik)
const KATEGORIEN = ['PSAgA', 'Bergsport', 'Arbeitssicherheit', 'Sonstiges'];

// Schweregrad-Definitionen: Schlüssel -> Anzeigetext + Chip-Klasse
const SCHWEREGRADE = {
  high:   { label: 'Akute Gefahr',     short: 'akut',     cls: 'sev-high' },
  medium: { label: 'Rückruf',          short: 'Rückruf',  cls: 'sev-medium' },
  info:   { label: 'Sicherheitsprüfung', short: 'Prüfung', cls: 'sev-info' },
};

// Anzahl der maximal direkt angezeigten Produkt-Chips
const MAX_PRODUKT_CHIPS = 6;
// Zeichenlänge, ab der die Zusammenfassung einklappbar wird
const SUMMARY_CLAMP_LEN = 220;

/* ---------- Zustand (State) ---------- */

const state = {
  recalls: [],          // alle Rückrufe (Rohliste)
  meta: null,           // meta-Objekt aus der JSON
  fromCache: false,     // wurde aus Offline-Cache geladen?
  filter: {
    kategorien: new Set(),   // leere Menge = alle
    schweregrade: new Set(), // leere Menge = alle
    suche: '',
    hersteller: '',
    quelle: '',
  },
};

/* ---------- DOM-Referenzen ---------- */

const $ = (sel) => document.querySelector(sel);

const el = {
  updatedAt: $('#updatedAt'),
  sourcesCount: $('#sourcesCount'),
  stats: $('#stats'),
  statTotal: $('#statTotal'),
  sourceHealth: $('#sourceHealth'),
  sourceHealthBody: $('#sourceHealthBody'),
  sourceHealthHint: $('#sourceHealthHint'),
  filters: $('#filters'),
  categoryChips: $('#categoryChips'),
  severityChips: $('#severityChips'),
  searchInput: $('#searchInput'),
  manufacturerSelect: $('#manufacturerSelect'),
  sourceSelect: $('#sourceSelect'),
  resetBtn: $('#resetBtn'),
  resultCount: $('#resultCount'),
  stateLoading: $('#stateLoading'),
  stateError: $('#stateError'),
  errorDetail: $('#errorDetail'),
  retryBtn: $('#retryBtn'),
  stateEmpty: $('#stateEmpty'),
  cardList: $('#cardList'),
  disclaimerBox: $('#disclaimerBox'),
};

/* ============================================================
   Hilfsfunktionen
   ============================================================ */

/**
 * Prüft eine URL und gibt sie nur zurück, wenn sie http/https ist.
 * Schützt vor javascript:, data: u. ä. aus Fremddaten.
 */
function sicherUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    const u = new URL(url, window.location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

/** Datum (ISO YYYY-MM-DD oder null) -> "14. Juni 2026" bzw. Fallback-Text. */
function formatDatum(iso) {
  if (!iso) return 'Datum unbekannt';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 'Datum unbekannt';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** ISO-Zeitstempel -> "14. Juni 2026, 15:42" (de-DE). */
function formatZeitstempel(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-DE', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Vergleichswert für die Sortierung (null-Datum -> ganz ans Ende). */
function datumWert(r) {
  if (!r.date) return -Infinity;
  const t = new Date(r.date + 'T00:00:00').getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

/** Hersteller-Anzeigename: bevorzugt manufacturerName, sonst manufacturer. */
function herstellerName(r) {
  return r.manufacturerName || r.manufacturer || 'Unbekannt';
}

/**
 * Konsolidierungs-Schlüssel für den Hersteller-Filter: brandKey fasst die
 * verschiedenen Schreibweisen einer Marke zusammen (z. B. „Ortovox USA, …"
 * und „Ortovox, of Germany"); ohne brandKey dient der Anzeigename als Schlüssel.
 */
function herstellerKey(r) {
  if (r.brandKey) return r.brandKey;
  // Ohne brandKey: Namen normalisieren, damit Schreibvarianten zusammenfallen
  // (z. B. „ORTOVOX", „Ortovox USA, of Hopkinton, N.H.", „Ortovox, of Germany").
  return herstellerBasis(herstellerName(r)) || herstellerName(r);
}

// Standort-/Rechtsform-Rauschen für die Hersteller-Konsolidierung (konservativ).
const HERSTELLER_RAUSCH = /\b(usa|inc|llc|gmbh|ag|ltd|limited|co|corp|corporation|company|sri|srl|spa|of)\b/gi;
function herstellerBasis(name) {
  return String(name || '')
    .split(',')[0] // alles ab erstem Komma (Standort/Rechtsform) entfernen
    .toLowerCase()
    .replace(HERSTELLER_RAUSCH, ' ')
    .replace(/[^a-z0-9äöüé ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kürzt eine Liste sicher und liefert ein Array von Strings. */
function alsStringListe(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.trim() !== '');
}

/** Erzeugt ein Element mit optionalen Klassen und Textinhalt (sicher). */
function erstelle(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Erzeugt einen externen Link (target=_blank, rel=noopener) – nur bei gültiger URL. */
function externLink(url, text, className) {
  const safe = sicherUrl(url);
  if (!safe) return null;
  const a = erstelle('a', className, text);
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/* ============================================================
   Daten laden
   ============================================================ */

async function ladeDaten() {
  zeigeZustand('loading');
  try {
    // cache:'no-cache' -> immer revalidieren; ein Service Worker kann
    // bei Offline-Betrieb dennoch eine zwischengespeicherte Antwort liefern.
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Der Service Worker liefert bei Offline-Betrieb eine 503-Antwort
    // ({error:'offline'}); diese fangen wir als Fehlerfall ab.
    const data = await res.json();
    if (!data || !Array.isArray(data.recalls)) {
      if (data && data.error === 'offline') {
        state.fromCache = true;
        throw new Error('Offline – keine zwischengespeicherten Daten verfügbar.');
      }
      throw new Error('Unerwartetes Datenformat.');
    }

    state.recalls = data.recalls;
    state.meta = data.meta || {};

    initNachLaden();
  } catch (err) {
    zeigeFehler(err);
  }
}

/** Einmalige Initialisierung nach erfolgreichem Laden. */
function initNachLaden() {
  renderKopf();
  renderStatistik();
  renderQuellenStatus();
  baueKategorieChips();
  baueSchweregradChips();
  baueHerstellerOptionen();
  baueQuelleOptionen();
  renderDisclaimer();
  anwenden();
}

/* ============================================================
   Kopf / Statistik / Footer
   ============================================================ */

function renderKopf() {
  const m = state.meta;
  el.updatedAt.textContent = 'Zuletzt aktualisiert: ' + formatZeitstempel(m.generatedAt);

  const quellen = alsStringListe((m.sources || []).map((s) => s && s.label));
  if (quellen.length) {
    el.sourcesCount.textContent = `${quellen.length} Quellen: ${quellen.join(' · ')}`;
  }
}

function renderStatistik() {
  const m = state.meta;
  const total = typeof m.total === 'number' ? m.total : state.recalls.length;
  el.statTotal.textContent = String(total);

  const byCat = m.byCategory || {};
  const map = {
    PSAgA: '#statPSAgA',
    Bergsport: '#statBergsport',
    Arbeitssicherheit: '#statArbeitssicherheit',
    Sonstiges: '#statSonstiges',
  };
  for (const [cat, sel] of Object.entries(map)) {
    const node = $(sel);
    if (node) node.textContent = String(byCat[cat] ?? 0);
  }
  el.stats.hidden = false;
  el.filters.hidden = false;
}

/**
 * Quellen-Status: zeigt transparent, welche Abruf-Quelle zuletzt lief
 * (ok / leer / Fehler), wie viele Treffer sie lieferte und – für die
 * Hersteller-Gruppe – die Aufschlüsselung je Marke. Daten aus meta.sources
 * (Abruf-Gesundheit) und meta.bySource (finale Zähler je Quelle).
 */
function renderQuellenStatus() {
  const m = state.meta;
  if (!el.sourceHealth || !el.sourceHealthBody) return;
  const groups = Array.isArray(m.sources) ? m.sources : [];
  if (!groups.length && !m.bySource) return;

  // source -> sourceLabel (für lesbare Markennamen in der Aufschlüsselung)
  const labelMap = {};
  for (const r of state.recalls) {
    if (r.source && r.sourceLabel) labelMap[r.source] = r.sourceLabel;
  }

  el.sourceHealthBody.replaceChildren();
  let okCount = 0;

  for (const s of groups) {
    const ok = s.ok !== false;
    const count = typeof s.count === 'number' ? s.count : 0;
    const status = !ok ? 'err' : count > 0 ? 'ok' : 'warn';
    if (status === 'ok') okCount++;

    const row = erstelle('div', 'sh-row');
    const dot = erstelle('span', 'sh-dot sh-' + status);
    dot.setAttribute('aria-hidden', 'true');
    row.append(dot, erstelle('span', 'sh-label', s.label || s.key));

    const meta = erstelle('span', 'sh-meta');
    if (!ok) meta.textContent = 'Fehler' + (s.error ? `: ${s.error}` : '');
    else if (count === 0) meta.textContent = 'keine Treffer (best-effort)';
    else meta.textContent = `${count} Treffer` + (typeof s.ms === 'number' ? ` · ${(s.ms / 1000).toFixed(1)} s` : '');
    row.append(meta);
    el.sourceHealthBody.append(row);
  }

  // Hersteller-Aufschlüsselung je Marke (aus bySource, ohne CPSC/SafetyGate)
  const by = m.bySource || {};
  const brandKeys = Object.keys(by).filter((k) => k !== 'CPSC' && k !== 'SafetyGate');
  if (brandKeys.length) {
    const sub = erstelle('div', 'sh-brands');
    sub.append(erstelle('span', 'sh-brands-label', 'Hersteller-Hubs: '));
    const parts = brandKeys
      .sort((a, b) => (by[b] - by[a]))
      .map((k) => `${labelMap[k] || k} (${by[k]})`);
    sub.append(document.createTextNode(parts.join(' · ')));
    el.sourceHealthBody.append(sub);
  }

  el.sourceHealthBody.append(
    erstelle('p', 'sh-stand', `Stand: ${formatZeitstempel(m.generatedAt)} · automatische Aktualisierung alle 6 Stunden`)
  );

  if (el.sourceHealthHint) {
    el.sourceHealthHint.textContent = groups.length ? `${okCount}/${groups.length} Quellen aktiv` : '';
  }
  el.sourceHealth.hidden = false;
}

function renderDisclaimer() {
  const text = state.meta && state.meta.disclaimer
    ? state.meta.disclaimer
    : 'Best-Effort-Aggregation öffentlicher Quellen. Keine Gewähr für Vollständigkeit oder Aktualität.';
  // Hinweis-Label voranstellen (sicher per createElement)
  el.disclaimerBox.replaceChildren();
  const label = erstelle('strong', null, 'Hinweis: ');
  el.disclaimerBox.append(label, document.createTextNode(text));
}

/* ============================================================
   Filter-UI aufbauen
   ============================================================ */

function baueKategorieChips() {
  el.categoryChips.replaceChildren();

  // "Alle"-Chip (setzt Kategorienauswahl zurück)
  const alle = erstelleChip('Alle', () => {
    state.filter.kategorien.clear();
    syncKategorieChips();
    anwenden();
  });
  alle.dataset.cat = '__alle__';
  el.categoryChips.append(alle);

  for (const cat of KATEGORIEN) {
    const chip = erstelleChip(cat, () => {
      toggleSet(state.filter.kategorien, cat);
      syncKategorieChips();
      anwenden();
    });
    chip.dataset.cat = cat;
    el.categoryChips.append(chip);
  }
  syncKategorieChips();
}

function baueSchweregradChips() {
  el.severityChips.replaceChildren();
  for (const [key, def] of Object.entries(SCHWEREGRADE)) {
    const chip = erstelleChip(def.short, () => {
      toggleSet(state.filter.schweregrade, key);
      syncSchweregradChips();
      anwenden();
    });
    chip.classList.add('chip-' + def.cls);
    chip.dataset.sev = key;
    // Farbpunkt vor den Text setzen
    const dot = erstelle('span', 'chip-dot');
    dot.setAttribute('aria-hidden', 'true');
    chip.prepend(dot);
    el.severityChips.append(chip);
  }
  syncSchweregradChips();
}

/** Erzeugt einen Toggle-Chip-Button (aria-pressed gepflegt). */
function erstelleChip(text, onClick) {
  const btn = erstelle('button', 'chip', text);
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', onClick);
  return btn;
}

/** Toggle-Helfer für ein Set. */
function toggleSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

/** Synchronisiert aria-pressed der Kategorie-Chips mit dem State. */
function syncKategorieChips() {
  const keine = state.filter.kategorien.size === 0;
  el.categoryChips.querySelectorAll('.chip').forEach((chip) => {
    const cat = chip.dataset.cat;
    const aktiv = cat === '__alle__' ? keine : state.filter.kategorien.has(cat);
    chip.setAttribute('aria-pressed', String(aktiv));
  });
  // Statistik-Kacheln spiegeln die Kategorienauswahl (sie sind klickbare Filter).
  document.querySelectorAll('.stat-cat').forEach((s) => {
    s.setAttribute('aria-pressed', String(state.filter.kategorien.has(s.dataset.cat)));
  });
}

function syncSchweregradChips() {
  el.severityChips.querySelectorAll('.chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(state.filter.schweregrade.has(chip.dataset.sev)));
  });
}

/**
 * Hersteller-Dropdown dynamisch befüllen. Gruppiert über herstellerKey
 * (eine Option je Marke statt je Schreibweise); als Anzeige dient der
 * kürzeste/erste vorkommende Name. option.value = Schlüssel.
 */
function baueHerstellerOptionen() {
  const labelFuerKey = new Map();
  for (const r of state.recalls) {
    const key = herstellerKey(r);
    const name = herstellerName(r);
    const bisher = labelFuerKey.get(key);
    // kürzesten (= meist saubersten) Namen je Schlüssel wählen
    if (!bisher || name.length < bisher.length) labelFuerKey.set(key, name);
  }
  const eintraege = [...labelFuerKey.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'de'));

  // bestehende dynamische Optionen entfernen, "Alle Hersteller" behalten
  while (el.manufacturerSelect.options.length > 1) el.manufacturerSelect.remove(1);
  for (const [key, label] of eintraege) {
    const opt = erstelle('option', null, label);
    opt.value = key;
    el.manufacturerSelect.append(opt);
  }
}

/** Quelle-Dropdown aus sourceLabel-Werten befüllen. */
function baueQuelleOptionen() {
  const labels = new Set();
  for (const r of state.recalls) {
    if (typeof r.sourceLabel === 'string' && r.sourceLabel.trim()) labels.add(r.sourceLabel);
  }
  const sortiert = [...labels].sort((a, b) => a.localeCompare(b, 'de'));
  while (el.sourceSelect.options.length > 1) el.sourceSelect.remove(1);
  for (const label of sortiert) {
    const opt = erstelle('option', null, label);
    opt.value = label;
    el.sourceSelect.append(opt);
  }
}

/* ============================================================
   Filterlogik
   ============================================================ */

/** Liefert die gefilterte und sortierte Trefferliste. */
function gefilterteRecalls() {
  const f = state.filter;
  const suchworte = f.suche.toLowerCase().trim();

  const treffer = state.recalls.filter((r) => {
    // Kategorie (leere Menge = alle)
    if (f.kategorien.size && !f.kategorien.has(r.category)) return false;
    // Schweregrad
    if (f.schweregrade.size && !f.schweregrade.has(r.severity)) return false;
    // Hersteller (Vergleich über konsolidierten Schlüssel)
    if (f.hersteller && herstellerKey(r) !== f.hersteller) return false;
    // Quelle
    if (f.quelle && r.sourceLabel !== f.quelle) return false;
    // Volltextsuche über Titel, Hersteller, Produkte, Zusammenfassung
    if (suchworte) {
      const heuhaufen = [
        r.title,
        herstellerName(r),
        r.summary,
        ...alsStringListe(r.products),
      ].join(' ').toLowerCase();
      if (!heuhaufen.includes(suchworte)) return false;
    }
    return true;
  });

  // Sortierung nach Datum absteigend; null-Datum (-Infinity) ans Ende
  treffer.sort((a, b) => datumWert(b) - datumWert(a));
  return treffer;
}

/** Filter anwenden -> Liste rendern + Trefferzähler aktualisieren. */
function anwenden() {
  const treffer = gefilterteRecalls();
  const gesamt = state.recalls.length;

  el.resultCount.textContent = `${treffer.length} von ${gesamt} Rückrufen`;

  if (treffer.length === 0) {
    zeigeZustand('empty');
    return;
  }
  zeigeZustand('list');
  renderListe(treffer);
}

/** Setzt alle Filter zurück. */
function filterZuruecksetzen() {
  state.filter.kategorien.clear();
  state.filter.schweregrade.clear();
  state.filter.suche = '';
  state.filter.hersteller = '';
  state.filter.quelle = '';
  el.searchInput.value = '';
  el.manufacturerSelect.value = '';
  el.sourceSelect.value = '';
  syncKategorieChips();
  syncSchweregradChips();
  anwenden();
}

/* ============================================================
   Kartenliste rendern
   ============================================================ */

function renderListe(treffer) {
  // Komplett neu aufbauen (Datenmenge ist überschaubar).
  const frag = document.createDocumentFragment();
  for (const r of treffer) frag.append(renderKarte(r));
  el.cardList.replaceChildren(frag);
}

/** Baut eine einzelne Rückruf-Karte (<li><article>…). */
function renderKarte(r) {
  const sevDef = SCHWEREGRADE[r.severity] || SCHWEREGRADE.info;

  const li = erstelle('li');
  const card = erstelle('article', `card ${sevDef.cls}`);

  /* --- Kopfzeile: Badge + Kategorie-Tag + Datum --- */
  const top = erstelle('div', 'card-top');
  top.append(erstelle('span', `badge ${sevDef.cls}`, sevDef.label));
  if (typeof r.category === 'string' && r.category) {
    top.append(erstelle('span', 'tag', r.category));
  }
  top.append(erstelle('span', 'card-date', formatDatum(r.date)));
  card.append(top);

  /* --- Hauptteil: Text links, optionales Bild rechts --- */
  const body = erstelle('div', 'card-body');
  const main = erstelle('div', 'card-main');

  // Hersteller + Quelle
  const meta = erstelle('p', 'card-meta');
  meta.append(erstelle('strong', null, herstellerName(r)));
  if (typeof r.sourceLabel === 'string' && r.sourceLabel) {
    meta.append(document.createTextNode(' · Quelle: ' + r.sourceLabel));
  }
  main.append(meta);

  // Titel
  main.append(erstelle('h3', 'card-title', r.title || 'Ohne Titel'));

  // Zusammenfassung (einklappbar, wenn lang)
  if (typeof r.summary === 'string' && r.summary.trim()) {
    main.append(renderZusammenfassung(r.summary.trim()));
  }

  // Gefahrhinweis
  if (typeof r.hazard === 'string' && r.hazard.trim()) {
    const hz = erstelle('p', 'hazard');
    hz.append(erstelle('strong', null, '⚠ Gefahr: '));
    hz.append(document.createTextNode(r.hazard.trim()));
    main.append(hz);
  }

  // Produkt-Chips
  const produkte = alsStringListe(r.products);
  if (produkte.length) {
    main.append(renderProduktChips(produkte));
  }

  body.append(main);

  // Vorschaubild (erste gültige Bild-URL)
  const bildUrl = sicherUrl(alsStringListe(r.images)[0]);
  if (bildUrl) {
    const img = erstelle('img', 'card-image');
    img.src = bildUrl;
    img.alt = r.title || 'Produktabbildung';
    img.loading = 'lazy';
    img.width = 96;
    img.height = 96;
    img.referrerPolicy = 'no-referrer';
    // Bei Ladefehler still ausblenden
    img.addEventListener('error', () => img.remove());
    body.append(img);
  }

  card.append(body);

  /* --- Aktionszeile --- */
  card.append(renderAktionen(r));

  li.append(card);
  return li;
}

/** Zusammenfassung mit optionalem "mehr/weniger"-Umschalter. */
function renderZusammenfassung(text) {
  const wrap = document.createDocumentFragment();
  const p = erstelle('p', 'card-summary', text);
  wrap.append(p);

  if (text.length > SUMMARY_CLAMP_LEN) {
    p.classList.add('clamp');
    const btn = erstelle('button', 'more-btn', 'mehr');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const ein = p.classList.toggle('clamp');
      btn.textContent = ein ? 'mehr' : 'weniger';
      btn.setAttribute('aria-expanded', String(!ein));
    });
    wrap.append(btn);
  }
  return wrap;
}

/** Produkt-Chips (max. MAX_PRODUKT_CHIPS, Rest als "+N"). */
function renderProduktChips(produkte) {
  const box = erstelle('div', 'product-chips');
  const sichtbar = produkte.slice(0, MAX_PRODUKT_CHIPS);
  for (const prod of sichtbar) {
    const chip = erstelle('span', 'product-chip', prod);
    chip.title = prod; // vollständiger Text als Tooltip (kann gekürzt dargestellt sein)
    box.append(chip);
  }
  const rest = produkte.length - sichtbar.length;
  if (rest > 0) {
    box.append(erstelle('span', 'product-chip product-more', `+${rest} weitere`));
  }
  return box;
}

/** Aktionszeile: Quelle(n) + optional Hersteller-Seite. */
function renderAktionen(r) {
  const actions = erstelle('div', 'card-actions');

  // "Details (Quelle)" -> sourceUrl
  const quelleLink = externLink(r.sourceUrl, 'Details (Quelle) ↗', 'btn btn-ghost btn-sm');
  if (quelleLink) actions.append(quelleLink);

  // Weitere Quellen (falls mehr als eine vorhanden und abweichend)
  const weitere = Array.isArray(r.sources) ? r.sources : [];
  if (weitere.length > 1) {
    const extra = erstelle('span', 'extra-sources');
    for (const s of weitere) {
      const url = sicherUrl(s && s.url);
      if (!url || url === sicherUrl(r.sourceUrl)) continue;
      const label = (s && s.sourceLabel) || 'Quelle';
      const link = externLink(url, label + ' ↗', 'btn btn-ghost btn-sm');
      if (link) extra.append(link);
    }
    if (extra.childElementCount) actions.append(extra);
  }

  // Hersteller-Seite -> manufacturerUrl (prominenter Button)
  const herstellerLink = externLink(r.manufacturerUrl, 'Hersteller-Seite ↗', 'btn btn-primary btn-sm');
  if (herstellerLink) {
    // Wenn die Hersteller-URL gleich der Startseite ist: Hinweis als title.
    const home = sicherUrl(r.manufacturerHome);
    const mfr = sicherUrl(r.manufacturerUrl);
    if (home && mfr && home === mfr) {
      herstellerLink.title = 'Hersteller-Startseite';
    }
    actions.append(herstellerLink);

    if (home && mfr && home === mfr) {
      actions.append(erstelle('span', 'action-hint', 'Hinweis: führt zur Hersteller-Startseite, nicht direkt zur Rückrufmeldung.'));
    }
  }

  return actions;
}

/* ============================================================
   Zustands-Umschaltung (Laden / Fehler / leer / Liste)
   ============================================================ */

function zeigeZustand(modus) {
  el.stateLoading.hidden = modus !== 'loading';
  el.stateError.hidden = modus !== 'error';
  el.stateEmpty.hidden = modus !== 'empty';
  el.cardList.hidden = modus !== 'list';
}

function zeigeFehler(err) {
  zeigeZustand('error');
  // Offline-Fall (vom Browser oder SW gemeldet) gesondert benennen.
  const offline = state.fromCache || (typeof navigator !== 'undefined' && navigator.onLine === false);
  let text = offline
    ? 'Keine Internetverbindung – es liegen keine offline zwischengespeicherten Rückrufdaten vor. Bitte später erneut versuchen.'
    : 'Bitte Internetverbindung prüfen und erneut versuchen.';
  const detail = err && err.message ? ` (Technischer Hinweis: ${err.message})` : '';
  el.errorDetail.textContent = text + detail;
}

/* ============================================================
   Event-Verdrahtung
   ============================================================ */

/** Einfaches Debounce für die Live-Suche. */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function verdrahteEvents() {
  // Volltextsuche (debounced ~150ms)
  el.searchInput.addEventListener('input', debounce((e) => {
    state.filter.suche = e.target.value;
    anwenden();
  }, 150));

  el.manufacturerSelect.addEventListener('change', (e) => {
    state.filter.hersteller = e.target.value;
    anwenden();
  });

  el.sourceSelect.addEventListener('change', (e) => {
    state.filter.quelle = e.target.value;
    anwenden();
  });

  el.resetBtn.addEventListener('click', filterZuruecksetzen);
  el.retryBtn.addEventListener('click', ladeDaten);

  // Statistik-Kacheln als Kategorie-Schnellfilter (toggeln wie die Chips).
  document.querySelectorAll('.stat-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSet(state.filter.kategorien, btn.dataset.cat);
      syncKategorieChips();
      anwenden();
    });
  });
}

/* ============================================================
   Service Worker (PWA) – mit Fehler-Catch
   ============================================================ */

function registriereServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Nach dem Laden registrieren, um den Erststart nicht zu verzögern.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      // Nicht kritisch – App funktioniert auch ohne SW.
      console.warn('Service Worker konnte nicht registriert werden:', err);
    });
  });
}

/* ============================================================
   Start
   ============================================================ */

verdrahteEvents();
registriereServiceWorker();
ladeDaten();

// fetch-manufacturers.js — Hersteller-Rückrufseiten.
// Best-Effort: extrahiert Detail-Links aus den Rückruf-Hubs. Direkte Hubs
// (Edelrid) werden per curl gelesen; JS-gerenderte / bot-geschützte Hubs
// (Petzl, Mammut, Skylotec) über den r.jina.ai-Proxy als Markdown. Bricht bei
// Seitenumbau sauber ab (leeres Ergebnis), ohne den Gesamt-Build zu gefährden.
import { fetchText, fetchViaProxy, sleep } from './http.js';
import { extractAllLinks, titleFromSlug, absUrl } from './html.js';
import { classifyCategory, classifySeverity, attachManufacturer } from './taxonomy.js';

// hostMust: jeder Hub akzeptiert nur Links seiner eigenen Domain. Das verhindert
// Fehlzuordnung von Fremdmarken-Links, die manche Hub-Seiten mit aufführen
// (z. B. listet die Skylotec-Seite auch Climbing-Technology-Meldungen).
const HUBS = [
  {
    // Direkt (curl) – DE-Hub; deutsche Zielgruppe.
    source: 'Edelrid', sourceLabel: 'EDELRID', via: 'direct', base: 'https://edelrid.com',
    url: 'https://edelrid.com/de-de/service/warnhinweis', hostMust: 'edelrid.com',
    linkRe: /\/de-de\/service\/warnhinweis\/[a-z0-9-]{6,}/i,
  },
  {
    // Proxy – Liste ist JS-gerendert; Datum steckt im URL-Pfad.
    source: 'Petzl', sourceLabel: 'Petzl', via: 'proxy', base: 'https://www.petzl.com',
    url: 'https://www.petzl.com/INT/en/Professional/safety-alerts', hostMust: 'petzl.com',
    linkRe: /\/safety-alerts\/\d{4}-\d{1,2}-\d{1,2}\/[a-z0-9-]{4,}/i,
    dateFromUrl: /(\d{4})-(\d{1,2})-(\d{1,2})/,
  },
  {
    // Proxy – Newsroom mischt Marketing & Rückrufe; Slug muss Rückruf-Begriff enthalten.
    source: 'Mammut', sourceLabel: 'Mammut', via: 'proxy', base: 'https://pr.mammut.com',
    url: 'https://pr.mammut.com/', hostMust: 'mammut.com',
    linkRe: /pr\.mammut\.com\/[a-z0-9-]{8,}/i,
    slugMust: /rueckruf|recall|aufruf|selbstkontrolle|kontrollaufruf|sicherheit|safety|ueberpruefung|barryvox|skywalker|warnung/i,
  },
  {
    // Direkt (curl) – saubere /alerts-Liste, Datum im Slug (en + it Monatsnamen).
    source: 'ClimbingTechnology', sourceLabel: 'Climbing Technology', via: 'direct',
    base: 'https://www.climbingtechnology.com',
    url: 'https://www.climbingtechnology.com/en/alerts', hostMust: 'climbingtechnology.com',
    linkRe: /\/en\/alerts\/[a-z0-9-]{4,}/i,
    slugDeny: /\/alerts\/feed\b/i,
    dateFromSlug: true,
  },
  {
    // Proxy – Sonderfall: Rückrufe als PDF (Product_recall_<Name>_<JJJJMMTT>) + /alerts/-Seiten.
    source: 'Skylotec', sourceLabel: 'SKYLOTEC', via: 'proxy', base: 'https://www.skylotec.com',
    url: 'https://www.skylotec.com/int_de/Retouren-und-Rueckrufe/', hostMust: 'skylotec.com',
    mode: 'skylotec',
  },
];

// Monatsnamen (Englisch + Italienisch) -> Monatszahl, für CT-Slugs.
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7,
  agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

// Datum aus CT-Slug: "02-november-2021-…", "15-gennaio-2020-…", "august-2012-…".
function dateFromSlug(url) {
  const slug = String(url).split('/').filter(Boolean).pop() || '';
  const year = (slug.match(/\b(20[12]\d)\b/) || [])[1];
  if (!year) return null;
  let month = null;
  for (const name in MONTHS) {
    if (slug.includes(name)) { month = MONTHS[name]; break; }
  }
  if (!month) return null;
  const day = (slug.match(/^(\d{1,2})-/) || [])[1] || '1';
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Generische Call-to-Action-Texte, die kein Rückruf-Titel sind.
const CTA = /^(jetzt ansehen|mehr( erfahren)?|weiterlesen|details?|hier( klicken)?|view( more)?|read more|learn more|more|zum produkt|download|pdf)$/i;
const pad = (s) => String(s).padStart(2, '0');

function yearGuess(text) {
  const m = String(text || '').match(/\b(20[12]\d)\b/);
  return m ? `${m[1]}-01-01` : null;
}

function cleanTitle(link, url) {
  const t = (link.text || '').trim();
  if (t && t.length > 10 && !CTA.test(t)) return t;
  return titleFromSlug(url);
}

function recordFrom(hub, url, title, date) {
  const text = `${hub.source} ${title}`;
  const rec = {
    id: `${hub.source}:${url}`,
    source: hub.source,
    sourceLabel: hub.sourceLabel,
    date,
    // lesbarer Markenname (mit Leerzeichen) -> matchBrand findet die Marke
    manufacturer: hub.sourceLabel || hub.source,
    title: String(title || '').slice(0, 200) || titleFromSlug(url),
    summary: '',
    hazard: null,
    severity: classifySeverity(text),
    category: classifyCategory(text),
    products: [],
    countries: ['EU'],
    sourceUrl: url,
    images: [],
  };
  return attachManufacturer(rec);
}

// Prüft, ob die URL zur erwarteten Hub-Domain gehört (gegen Fremdmarken-Bleed).
function hostOk(hub, url) {
  if (!hub.hostMust) return true;
  try {
    return new URL(url).host.includes(hub.hostMust);
  } catch {
    return false;
  }
}

// Link-basierte Hubs (Edelrid, Petzl, Mammut, Climbing Technology).
function scrapeLinks(hub, content) {
  // Kandidaten sammeln: (a) echte <a>-/Markdown-Links, (b) Rohscan nach dem
  // Pfadmuster (manche Seiten liefern Links nur im JSON/Script, nicht als <a>).
  const candidates = new Map(); // url -> Linktext
  for (const link of extractAllLinks(content)) {
    const url = absUrl(link.href, hub.base);
    if (url && !candidates.has(url)) candidates.set(url, link.text || '');
  }
  const rawRe = new RegExp(hub.linkRe.source, 'gi');
  let rm;
  while ((rm = rawRe.exec(content))) {
    if (!rm[0].startsWith('/')) continue; // nur Pfadmuster gefahrlos absolutieren
    const url = absUrl(rm[0], hub.base);
    if (url && !candidates.has(url)) candidates.set(url, '');
  }

  const out = [];
  for (const [url, text] of candidates) {
    if (!hostOk(hub, url)) continue;
    if (!hub.linkRe.test(url)) continue;
    if (hub.slugMust && !hub.slugMust.test(url)) continue;
    if (hub.slugDeny && hub.slugDeny.test(url)) continue;
    let date = null;
    if (hub.dateFromUrl) {
      const m = url.match(hub.dateFromUrl);
      if (m) date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    }
    if (!date && hub.dateFromSlug) date = dateFromSlug(url);
    if (!date) date = yearGuess(text) || yearGuess(url);
    out.push(recordFrom(hub, url, cleanTitle({ text }, url), date));
  }
  return out;
}

// Skylotec: PDF-Rückrufe (Product_recall_<Name>_<JJJJMMTT>) + /alerts/-Seiten.
function scrapeSkylotec(hub, content) {
  const seen = new Set();
  const out = [];
  for (const link of extractAllLinks(content)) {
    const url = absUrl(link.href, hub.base);
    if (!url || !hostOk(hub, url) || seen.has(url)) continue;
    let title;
    let date = null;
    const pm = url.match(/Product_recall_([A-Za-z0-9-]+)_(\d{8})/i);
    if (pm) {
      title = `Produktrückruf ${pm[1].replace(/-/g, ' ')}`;
      const d = pm[2];
      date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    } else if (/\/alerts\/[a-z0-9-]{4,}/i.test(url)) {
      title = cleanTitle(link, url);
    } else {
      continue;
    }
    seen.add(url);
    out.push(recordFrom(hub, url, title, date));
  }
  return out;
}

async function scrapeHub(hub) {
  let content;
  try {
    content = hub.via === 'proxy'
      ? await fetchViaProxy(hub.url)
      : await fetchText(hub.url, { timeout: 30000, retries: 1 });
  } catch (e) {
    console.warn(`[hersteller] ${hub.source} Hub nicht erreichbar (${hub.url}): ${e.message}`);
    return [];
  }
  const recs = hub.mode === 'skylotec' ? scrapeSkylotec(hub, content) : scrapeLinks(hub, content);
  console.log(`[hersteller] ${hub.source}: ${recs.length} Einträge (${hub.via})`);
  return recs;
}

export async function fetchManufacturers() {
  const all = [];
  for (const hub of HUBS) {
    all.push(...(await scrapeHub(hub)));
    await sleep(500); // höflich zum Proxy bleiben
  }
  return all;
}

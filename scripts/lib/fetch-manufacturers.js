// fetch-manufacturers.js — Hersteller-Rückrufseiten (Edelrid, Petzl …).
// Best-Effort: extrahiert Detail-Links aus den Rückruf-Hubs. Bricht bei Seiten-
// umbau sauber ab (leeres Ergebnis), ohne den Gesamt-Build zu gefährden.
import { fetchText, sleep } from './http.js';
import { extractLinks, titleFromSlug, absUrl } from './html.js';
import { classifyCategory, classifySeverity, attachManufacturer } from './taxonomy.js';

const HUBS = [
  {
    // Nur der DE-Hub (deutsche Zielgruppe); der EN-Hub spiegelt dieselben
    // Rückrufe und würde nur Dubletten erzeugen.
    source: 'Edelrid', sourceLabel: 'EDELRID', base: 'https://edelrid.com',
    url: 'https://edelrid.com/de-de/service/warnhinweis',
    linkRe: /\/de-de\/service\/warnhinweis\/[a-z0-9-]{6,}/i,
    dateFromUrl: null,
  },
  {
    source: 'Petzl', sourceLabel: 'Petzl', base: 'https://www.petzl.com',
    url: 'https://www.petzl.com/INT/en/Professional/safety-alerts',
    linkRe: /\/safety-alerts\/\d{4}-\d{1,2}-\d{1,2}\/[^"'#?\s]{4,}/i,
    dateFromUrl: /(\d{4})-(\d{1,2})-(\d{1,2})/,
  },
];

function yearGuess(text) {
  const m = String(text || '').match(/\b(20[12]\d)\b/);
  return m ? `${m[1]}-01-01` : null;
}

// Generische Call-to-Action-Texte, die kein Rückruf-Titel sind.
const CTA = /^(jetzt ansehen|mehr( erfahren)?|weiterlesen|details?|hier( klicken)?|view( more)?|read more|learn more|more|zum produkt|download)$/i;

function cleanTitle(link, url) {
  const t = (link.text || '').trim();
  if (t && t.length > 10 && !CTA.test(t)) return t;
  return titleFromSlug(url);
}

function normalize(hub, link) {
  const url = absUrl(link.href, hub.base);
  if (!url) return null;
  const title = cleanTitle(link, url);
  let date = null;
  if (hub.dateFromUrl) {
    const m = url.match(hub.dateFromUrl);
    if (m) date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  if (!date) date = yearGuess(title) || yearGuess(url);
  const text = `${hub.source} ${title}`;
  const rec = {
    id: `${hub.source}:${url}`,
    source: hub.source,
    sourceLabel: hub.sourceLabel,
    date,
    manufacturer: hub.source,
    title: title.slice(0, 200),
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

async function scrapeHub(hub) {
  let html;
  try {
    html = await fetchText(hub.url, { timeout: 30000, retries: 1 });
  } catch (e) {
    console.warn(`[hersteller] ${hub.source} Hub nicht erreichbar (${hub.url}): ${e.message}`);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const link of extractLinks(html)) {
    if (!hub.linkRe.test(link.href)) continue;
    const rec = normalize(hub, link);
    if (!rec || seen.has(rec.sourceUrl)) continue;
    seen.add(rec.sourceUrl);
    out.push(rec);
  }
  console.log(`[hersteller] ${hub.source}: ${out.length} Einträge (${hub.url})`);
  return out;
}

export async function fetchManufacturers() {
  const all = [];
  for (const hub of HUBS) {
    all.push(...(await scrapeHub(hub)));
    await sleep(400);
  }
  return all;
}

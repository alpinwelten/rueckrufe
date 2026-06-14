// fetch-cpsc.js — US Consumer Product Safety Commission (saferproducts.gov).
// Öffentliche REST-API, kein Key. Bestätigte Filter:
//   RecallTitle=<Marke>   -> Treffer per Substring im Titel ("Petzl America Recalls …")
//   ProductName=<Kategorie> -> Treffer per Produktbegriff ("harness" …)
// Wir kombinieren beides und deduplizieren über RecallID.
import { fetchJson, sleep } from './http.js';
import { classifyCategory, classifySeverity, summarize, attachManufacturer, isRelevant, SOURCE_LABELS } from './taxonomy.js';

const BASE = 'https://www.saferproducts.gov/RestWebServices/Recall?format=json';

// Produkt-/Kategoriebegriffe aus unserer Domäne (PSAgA / Bergsport / Arbeitssicherheit).
// 'helmet'/'pulley' bewusst NICHT als Einzelabfrage: dominiert von Fahrradhelmen
// u. Ä. Kletterhelme kommen über Marken- und 'climbing'-Abfragen herein.
const PRODUCT_QUERIES = [
  'lanyard', 'carabiner', 'climbing', 'mountaineering', 'via ferrata', 'crampon',
  'ice axe', 'belay', 'descender', 'ascender', 'fall protection', 'fall arrest',
  'energy absorber', 'climbing harness', 'avalanche', 'rope access',
];

// Markenname-Titel-Abfragen (die Titel lauten meist "<Marke> … Recalls …").
const BRAND_QUERIES = [
  'Petzl', 'Edelrid', 'Mammut', 'Black Diamond', 'Beal', 'Skylotec',
  'Climbing Technology', 'DMM', 'Sterling', 'Mad Rock', 'CAMP', 'Metolius',
  'Singing Rock', 'Grivel', 'Wild Country', 'Kong',
];

function pick(arr, ...keys) {
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => keys.map((k) => o?.[k]).find(Boolean)).filter(Boolean);
}

function brandFromTitle(title) {
  // "Petzl America Recalls X …" -> "Petzl America"
  const m = String(title || '').match(/^(.+?)\s+Recalls?\b/i);
  return m ? m[1].trim() : '';
}

function normalize(raw) {
  const title = raw.Title || '';
  const desc = raw.Description || '';
  const products = pick(raw.Products, 'Name').filter((n) => n && n.length > 1);
  const manufacturer = pick(raw.Manufacturers, 'Name')[0] || brandFromTitle(title) || 'Unbekannt';
  const hazards = pick(raw.Hazards, 'Name', 'HazardType');
  const countries = pick(raw.ManufacturerCountries, 'Country');
  const images = pick(raw.Images, 'URL');
  const text = [title, desc, products.join(' '), hazards.join(' ')].join(' ');

  const rec = {
    id: `CPSC:${raw.RecallID}`,
    source: 'CPSC',
    sourceLabel: SOURCE_LABELS.CPSC,
    date: (raw.RecallDate || raw.LastPublishDate || '').slice(0, 10) || null,
    manufacturer,
    title,
    summary: summarize(desc || title),
    hazard: hazards[0] || (title.match(/Due to ([^.;]+?Hazard)/i)?.[1] || '').trim() || null,
    severity: classifySeverity(text),
    category: classifyCategory(text),
    products: [...new Set(products)].slice(0, 12),
    countries: countries.length ? [...new Set(countries)] : ['US'],
    sourceUrl: raw.URL || null,
    images: images.slice(0, 4),
  };
  return attachManufacturer(rec);
}

export async function fetchCpsc() {
  const seen = new Map(); // RecallID -> raw
  const queries = [
    ...PRODUCT_QUERIES.map((q) => `&ProductName=${encodeURIComponent(q)}`),
    ...BRAND_QUERIES.map((q) => `&RecallTitle=${encodeURIComponent(q)}`),
  ];
  for (const qs of queries) {
    try {
      const arr = await fetchJson(BASE + qs, { timeout: 30000, retries: 1 });
      if (Array.isArray(arr)) {
        for (const r of arr) if (r?.RecallID && !seen.has(r.RecallID)) seen.set(r.RecallID, r);
      }
    } catch (e) {
      console.warn(`[cpsc] query failed ${qs}: ${e.message}`);
    }
    await sleep(250); // höflich bleiben
  }

  const out = [];
  for (const raw of seen.values()) {
    const rec = normalize(raw);
    if (!rec.date) continue;
    // Domänen-Filter: eindeutiger Domänenbegriff ODER bekannte Marke.
    const text = [rec.title, rec.summary, rec.products.join(' ')].join(' ');
    if (!isRelevant(text, rec.brandKey)) continue;
    out.push(rec);
  }
  console.log(`[cpsc] ${out.length} relevante Rückrufe (von ${seen.size} Treffern)`);
  return out;
}

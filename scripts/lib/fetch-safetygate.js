// fetch-safetygate.js — EU Safety Gate (RAPEX), best-effort.
// Die aktuelle Safety-Gate-API ist POST-only hinter einer WAF, die CI-Clients
// blockt. Wir lesen daher den gerenderten Such-Screen über den r.jina.ai-Proxy
// (rendert die Angular-SPA wie ein echter Browser). Der Proxy liefert je Meldung
// einen Block der Form:
//     ![Image N: card image](…/api/notification/image/<id>)
//     … | 12/06/2026
//     Alert number SR/01695/26 Product Baby carrier Risks …
// Wir parsen Referenz + Produkt + Datum, verwerfen Logo-/Asset-Rauschen und
// filtern STRIKT auf unsere Marken / Domänenbegriffe. Schlägt alles fehl -> []
// (kein Build-Abbruch).
import { fetchText } from './http.js';
import { matchBrand, classifyCategory, classifySeverity, summarize, attachManufacturer, isRelevant, SOURCE_LABELS } from './taxonomy.js';

const JINA = 'https://r.jina.ai/';
const SEARCH = 'https://ec.europa.eu/safety-gate-alerts/screen/search';
const TARGETS = [
  `${SEARCH}?sortType=PUBLICATION_DATE_DESC&page=0`,
  `${SEARCH}?sortType=PUBLICATION_DATE_DESC&page=1`,
];

// "Alert number <REF> Product <Produktname> <Stichwort> …"
const BLOCK = /Alert number\s+([A-Z]{1,4}\/\d{2,6}\/\d{2})\s+Product\s+([\s\S]{2,90}?)\s+(?:Risks?|Brand|Alert type|Country|Measures|Notified|Category|Counterfeit)\b/gi;
// Datumsmarker "| 12/06/2026"
const DATE = /\|\s*(\d{2})\/(\d{2})\/(\d{4})/g;

function nearestDateBefore(dateHits, pos) {
  let best = null;
  for (const h of dateHits) {
    if (h.index <= pos) best = h.iso;
    else break;
  }
  return best;
}

function normalize(ref, product, date) {
  const text = `${product} ${ref}`;
  const brand = matchBrand(product);
  const rec = {
    id: `SafetyGate:${ref}`,
    source: 'SafetyGate',
    sourceLabel: SOURCE_LABELS.SafetyGate,
    date,
    manufacturer: brand?.name || 'EU Safety Gate',
    title: `${product} (Safety-Gate-Meldung ${ref})`,
    summary: summarize(`EU-Safety-Gate-Schnellwarnung ${ref}: ${product}.`, 320),
    hazard: null,
    severity: classifySeverity(text),
    category: classifyCategory(text),
    products: [product.trim()].filter(Boolean),
    countries: ['EU'],
    // Kein zuverlässiger Deep-Link je Meldung -> offizielle Suchseite (Referenz im Titel).
    sourceUrl: SEARCH,
    images: [],
    reference: ref,
  };
  return attachManufacturer(rec);
}

export async function fetchSafetyGate() {
  const out = [];
  const seen = new Set();
  for (const target of TARGETS) {
    let md;
    try {
      md = await fetchText(JINA + target, { timeout: 45000, retries: 1 });
    } catch (e) {
      console.warn(`[safetygate] Proxy-Abruf fehlgeschlagen: ${e.message}`);
      continue;
    }

    // Datumsmarker einsammeln (Position -> ISO)
    const dateHits = [];
    let dm;
    DATE.lastIndex = 0;
    while ((dm = DATE.exec(md))) {
      dateHits.push({ index: dm.index, iso: `${dm[3]}-${dm[2]}-${dm[1]}` });
    }

    let m;
    BLOCK.lastIndex = 0;
    while ((m = BLOCK.exec(md))) {
      const ref = m[1].trim();
      const product = m[2].replace(/\s+/g, ' ').trim();
      if (!product || /^image\b|card image|logo/i.test(product)) continue;
      const date = nearestDateBefore(dateHits, m.index);
      const rec = normalize(ref, product, date);
      // Strikt filtern: nur PSAgA/Bergsport/Arbeitssicherheit-relevante Meldungen.
      if (!isRelevant(`${product} ${ref}`, rec.brandKey)) continue;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      out.push(rec);
    }
  }
  console.log(`[safetygate] ${out.length} relevante Meldungen (best-effort via Proxy)`);
  return out;
}

// taxonomy.js — Marken-Verzeichnis, Klassifikation (Kategorie + Schweregrad),
// Normalisierung und Deduplizierung. Geteilt von allen Fetchern und vom Build.
//
// Eine "Recall"-Einheit hat dieses Schema (siehe docs/spec.md):
//   { id, source, sourceLabel, date, manufacturer, title, summary, hazard,
//     severity, category, products[], countries[], sourceUrl,
//     manufacturerUrl, manufacturerName, images[] }

// ---------------------------------------------------------------------------
// Marken: Hersteller von PSAgA / Bergsport / Arbeitssicherheit.
// home   = offizielle Startseite (Fallback-Link, "Auf Hersteller-Startseite")
// recall = konkrete Rückruf-/Sicherheitsseite, falls bekannt
// aliases= Schreibweisen, wie sie in Quelldaten auftauchen (lowercase-Vergleich)
// ---------------------------------------------------------------------------
export const BRANDS = [
  { key: 'edelrid', name: 'EDELRID', home: 'https://edelrid.com/de-de', recall: 'https://edelrid.com/de-de/service/warnhinweis', aliases: ['edelrid'] },
  { key: 'petzl', name: 'Petzl', home: 'https://www.petzl.com', recall: 'https://www.petzl.com/INT/en/Professional/safety-alerts', aliases: ['petzl'] },
  { key: 'mammut', name: 'Mammut', home: 'https://www.mammut.com', recall: 'https://www.mammut.com/de/de/service/produktsicherheit', aliases: ['mammut'] },
  { key: 'blackdiamond', name: 'Black Diamond', home: 'https://www.blackdiamondequipment.com', recall: 'https://www.blackdiamondequipment.com/pages/product-recalls', aliases: ['black diamond', 'blackdiamond', 'black diamond equipment'] },
  { key: 'beal', name: 'Beal', home: 'https://www.beal-planet.com', recall: 'https://www.beal-planet.com', aliases: ['beal'] },
  { key: 'camp', name: 'CAMP', home: 'https://www.camp.it', recall: 'https://www.camp.it/en/safety-notice', aliases: ['camp', 'c a m p', 'camp safety'], ambiguous: true },
  { key: 'skylotec', name: 'SKYLOTEC', home: 'https://www.skylotec.com', recall: 'https://www.skylotec.com/int_de/Retouren-und-Rueckrufe/', aliases: ['skylotec'] },
  { key: 'austrialpin', name: 'AustriAlpin', home: 'https://www.austrialpin.at', recall: 'https://www.austrialpin.at', aliases: ['austrialpin', 'austri alpin'] },
  { key: 'singingrock', name: 'Singing Rock', home: 'https://www.singingrock.com', recall: 'https://www.singingrock.com', aliases: ['singing rock', 'singingrock'] },
  { key: 'climbingtechnology', name: 'Climbing Technology', home: 'https://www.climbingtechnology.com', recall: 'https://www.climbingtechnology.com/en/alerts', aliases: ['climbing technology', 'aludesign'] },
  { key: 'dmm', name: 'DMM', home: 'https://dmmwales.com', recall: 'https://dmmwales.com/pages/recall-info', aliases: ['dmm', 'dmm wales', 'dmm climbing'] },
  { key: 'grivel', name: 'Grivel', home: 'https://www.grivel.com', recall: 'https://www.grivel.com', aliases: ['grivel'] },
  { key: 'kong', name: 'KONG', home: 'https://www.kong.it', recall: 'https://www.kong.it', aliases: ['kong'], denies: ['hong kong'], ambiguous: true },
  { key: 'salewa', name: 'Salewa', home: 'https://www.salewa.com', recall: 'https://www.salewa.com', aliases: ['salewa', 'oberalp'] },
  { key: 'ocun', name: 'Ocún', home: 'https://www.ocun.com', recall: 'https://www.ocun.com', aliases: ['ocun', 'ocún'] },
  { key: 'wildcountry', name: 'Wild Country', home: 'https://www.wildcountry.com', recall: 'https://www.wildcountry.com', aliases: ['wild country', 'wildcountry'] },
  { key: 'sterling', name: 'Sterling Rope', home: 'https://sterlingrope.com', recall: 'https://sterlingrope.com/sterling-solid/all-articles/', aliases: ['sterling', 'sterling rope'], ambiguous: true },
  { key: 'tendon', name: 'Tendon', home: 'https://www.mytendon.com', recall: 'https://www.mytendon.com', aliases: ['tendon', 'lanex'], ambiguous: true },
  { key: 'metolius', name: 'Metolius', home: 'https://www.metoliusclimbing.com', recall: 'https://www.metoliusclimbing.com', aliases: ['metolius'] },
  { key: 'ortovox', name: 'ORTOVOX', home: 'https://www.ortovox.com', recall: 'https://www.ortovox.com', aliases: ['ortovox'] },
  { key: 'arva', name: 'Arva', home: 'https://www.arva-equipment.com', recall: 'https://www.arva-equipment.com', aliases: ['arva'] },
  { key: 'bca', name: 'Backcountry Access', home: 'https://backcountryaccess.com', recall: 'https://backcountryaccess.com', aliases: ['backcountry access'] },
  { key: 'omegapacific', name: 'Omega Pacific', home: 'https://www.omegapacific.com', recall: 'https://www.omegapacific.com', aliases: ['omega pacific'] },
  { key: 'smc', name: 'SMC (Seattle Manufacturing)', home: 'https://www.smcgear.net', recall: 'https://www.smcgear.net', aliases: ['seattle manufacturing', 'smc gear'] },
  { key: 'madrock', name: 'Mad Rock', home: 'https://www.madrock.com', recall: 'https://www.madrock.com', aliases: ['mad rock', 'madrock'] },
  { key: 'msa', name: 'MSA Safety', home: 'https://www.msasafety.com', recall: 'https://www.msasafety.com/recalls', aliases: ['msa', 'msa safety'], ambiguous: true },
  { key: '3m', name: '3M', home: 'https://www.3m.com', recall: 'https://www.3m.com', aliases: ['3m', 'capital safety', 'dbi sala', 'protecta'], ambiguous: true },
  { key: 'honeywell', name: 'Honeywell', home: 'https://www.honeywell.com', recall: 'https://www.honeywell.com', aliases: ['honeywell', 'miller'], ambiguous: true },
];

// Suffixe/Zusätze, die beim Markenabgleich entfernt werden.
const BRAND_NOISE = /\b(america|usa|inc\.?|llc|gmbh|co\.?|ltd\.?|limited|ag|equipment|sport|sports|s\.?p\.?a\.?|s\.?r\.?l\.?|corp\.?|corporation|company)\b/gi;

export function normalizeBrandText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(BRAND_NOISE, ' ')
    .replace(/[^a-z0-9äöüé ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Findet die Marke in einem freien Text (Titel/Hersteller/Produkt).
// Ganzwort-Vergleich (vermeidet "camping"->CAMP). denies blockt Fehltreffer
// (z. B. "Hong Kong" != KONG). Gibt das BRANDS-Objekt zurück oder null.
export function matchBrand(...texts) {
  const joined = texts.join(' ');
  const hay = ' ' + normalizeBrandText(joined) + ' ';
  // Mehrdeutige Marken (CAMP, KONG, 3M …) nur akzeptieren, wenn zusätzlich ein
  // eindeutiger Domänenbegriff vorkommt – sonst "Camp Chef", "Hong Kong" usw.
  const strong = hasStrongTerm(joined);
  for (const b of BRANDS) {
    if (b.denies && b.denies.some((d) => hay.includes(' ' + normalizeBrandText(d) + ' '))) continue;
    if (b.ambiguous && !strong) continue;
    for (const a of b.aliases) {
      if (hay.includes(' ' + a + ' ')) return b;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kategorisierung: PSAgA (PSA gegen Absturz) | Bergsport | Arbeitssicherheit | Sonstiges
// Priorität: PSAgA > Bergsport > Arbeitssicherheit. Mehrfachtreffer -> höchste Priorität.
//
// STRONG  = eindeutige Domänenbegriffe (genügen allein, um relevant zu sein)
// WEAK    = mehrdeutige Begriffe (helmet, rope …) – zählen nur, wenn zusätzlich
//           eine bekannte Marke erkannt wurde (sonst: Fahrrad-/Baby-/Bauhelm-Lärm)
// ---------------------------------------------------------------------------
const STRONG = {
  PSAgA: [
    'fall arrest', 'fall protection', 'fall hazard', 'self-retracting', 'energy absorber',
    'shock absorber', 'lanyard', 'fall arrester', 'work positioning', 'lifeline',
    'climbing harness', 'safety harness', 'full body harness',
    'auffanggurt', 'verbindungsmittel', 'falldämpfer', 'höhensicherung', 'absturzsicherung',
    'psa gegen absturz', 'psaga', 'anschlagpunkt', 'höhensicherungsgerät', 'abseilgerät', 'auffanggurte',
    // deutsche Produktbegriffe / Arboristik
    'baumpflege', 'baumpflegegurt', 'd-ring', 'd ring', 'rückhaltesystem',
  ],
  Bergsport: [
    'climbing', 'mountaineering', 'via ferrata', 'belay', 'quickdraw', 'carabiner', 'karabiner',
    'crampon', 'ice axe', 'ice tool', 'piolet', 'descender', 'ascender', 'avalanche',
    'klettersteig', 'klettern', 'kletter', 'klettergurt', 'steigeisen', 'eispickel',
    'eisgerät', 'kletterseil', 'sicherungsgerät', 'expressset', 'lawine', 'lawinen', 'transceiver',
    // Sicherungs-/Abseilgeräte & Kletter-Hardware (Modell-/Fachbegriffe)
    'ohmega', 'mega jul', 'micro jul', 'giga jul', 'grigri', 'reverso', 'klettersteigset',
    'hms', 'bulletproof', 'cable comfort', 'seilbremse', 'maillon', 'umlenkrolle',
    'schraubkarabiner', 'bandschlinge', 'eisschraube',
  ],
  Arbeitssicherheit: [
    'rope access', 'industrial fall', 'scaffold', 'work at height',
    'arbeitsschutz', 'höhenarbeit', 'industrieklettern', 'arbeitssicherheit',
  ],
};
const WEAK = {
  PSAgA: ['harness', 'anchor device', 'connector', 'restraint', 'abseil'],
  Bergsport: ['helmet', 'helm', 'rope', 'seil', 'pulley', 'rolle', 'sling', 'bandschlinge', 'cam ', 'belay device'],
  Arbeitssicherheit: ['ppe', 'safety footwear', 'hard hat', 'occupational', 'schutzausrüstung'],
};
const ORDER = ['PSAgA', 'Bergsport', 'Arbeitssicherheit'];

function hitsIn(t, set) {
  for (const cat of ORDER) if (set[cat].some((k) => t.includes(k))) return cat;
  return null;
}

// Enthält der Text mindestens einen eindeutigen Domänenbegriff?
export function hasStrongTerm(...texts) {
  const t = texts.join(' ').toLowerCase();
  return ORDER.some((cat) => STRONG[cat].some((k) => t.includes(k)));
}

// Ist der Eintrag für uns relevant? Eindeutiger Begriff ODER bekannte Marke.
export function isRelevant(text, hasBrand) {
  return hasStrongTerm(text) || !!hasBrand;
}

export function classifyCategory(...texts) {
  const t = texts.join(' ').toLowerCase();
  return hitsIn(t, STRONG) || hitsIn(t, WEAK) || 'Sonstiges';
}

// ---------------------------------------------------------------------------
// Schweregrad: high (akute Gefahr / sofort stoppen) | medium (Rückruf) | info (Prüfung)
// ---------------------------------------------------------------------------
const SEV_HIGH = ['fatal', 'death', 'die ', 'serious risk', 'stop using', 'serious injury',
  'lebensgefahr', 'tödlich', 'todesfolge', 'schwere verletzung', 'sofort', 'lebensgefährlich'];
const SEV_INFO = ['safety check', 'call for inspection', 'user inspection', 'precautionary',
  'safety notice', 'sicherheitsüberprüfung', 'sicherheitshinweis', 'warnhinweis', 'überprüfung',
  'inspection', 'check your'];

export function classifySeverity(...texts) {
  const t = texts.join(' ').toLowerCase();
  if (SEV_HIGH.some((k) => t.includes(k))) return 'high';
  if (/\brecall\b|\brückruf\b|\bzurückgerufen\b/.test(t)) return 'medium';
  if (SEV_INFO.some((k) => t.includes(k))) return 'info';
  return 'medium';
}

export const SOURCE_LABELS = {
  CPSC: 'US CPSC',
  SafetyGate: 'EU Safety Gate',
  Edelrid: 'EDELRID',
  Petzl: 'Petzl',
};

// Setzt manufacturerUrl/Name anhand der erkannten Marke.
// Fallback laut Nutzerwunsch: offizielle Hersteller-Startseite.
export function attachManufacturer(rec) {
  const b = matchBrand(rec.manufacturer || '', rec.title || '', (rec.products || []).join(' '));
  if (b) {
    rec.manufacturerName = b.name;
    rec.manufacturerUrl = b.recall || b.home;
    rec.manufacturerHome = b.home;
    rec.brandKey = b.key;
  } else {
    rec.manufacturerName = rec.manufacturer || null;
    rec.manufacturerUrl = null;
    rec.manufacturerHome = null;
    rec.brandKey = null;
  }
  return rec;
}

// Hängt eine BEKANNTE Marke direkt per Schlüssel an (für Hersteller-Hubs, bei
// denen die Marke feststeht – umgeht die ambiguous-Heuristik von matchBrand).
export function attachKnownBrand(rec, key) {
  const b = BRANDS.find((x) => x.key === key);
  if (b) {
    rec.manufacturerName = b.name;
    rec.manufacturerUrl = b.recall || b.home;
    rec.manufacturerHome = b.home;
    rec.brandKey = b.key;
  } else {
    rec.manufacturerName = rec.manufacturer || null;
    rec.manufacturerUrl = null;
    rec.manufacturerHome = null;
    rec.brandKey = null;
  }
  return rec;
}

// Stabile, quellenübergreifende Dedup-Schlüssel.
function significantWords(s) {
  return normalizeBrandText(s)
    .split(' ')
    .filter((w) => w.length >= 4)
    .sort()
    .slice(0, 6)
    .join('-');
}

export function dedupeKey(rec) {
  const brand = rec.brandKey || normalizeBrandText(rec.manufacturer).split(' ')[0] || 'x';
  const words = significantWords((rec.products || []).join(' ') || rec.title || '');
  const year = (rec.date || '').slice(0, 4);
  return `${brand}|${year}|${words}`;
}

// Merge: behält den reichhaltigsten Eintrag, sammelt Quellen.
export function dedupe(records) {
  const map = new Map();
  for (const r of records) {
    const k = dedupeKey(r);
    const existing = map.get(k);
    if (!existing) {
      r.sources = [{ source: r.source, sourceLabel: r.sourceLabel, url: r.sourceUrl }];
      map.set(k, r);
      continue;
    }
    // Quelle ergänzen
    if (!existing.sources.some((s) => s.source === r.source)) {
      existing.sources.push({ source: r.source, sourceLabel: r.sourceLabel, url: r.sourceUrl });
    }
    // Reichhaltigere Felder übernehmen
    if ((r.summary || '').length > (existing.summary || '').length) existing.summary = r.summary;
    if (!existing.images?.length && r.images?.length) existing.images = r.images;
    if (!existing.manufacturerUrl && r.manufacturerUrl) {
      existing.manufacturerUrl = r.manufacturerUrl;
      existing.manufacturerHome = r.manufacturerHome;
      existing.manufacturerName = r.manufacturerName;
      existing.brandKey = r.brandKey;
    }
    // Höchste Severity gewinnt
    const rank = { high: 3, medium: 2, info: 1 };
    if (rank[r.severity] > rank[existing.severity]) existing.severity = r.severity;
  }
  return [...map.values()];
}

// Kürzt Text auf eine sinnvolle Zusammenfassung.
export function summarize(text, max = 320) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

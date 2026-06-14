#!/usr/bin/env node
// build.js — Datenpipeline: holt alle Quellen, normalisiert, dedupliziert,
// sortiert und schreibt data/recalls.json. Jede Quelle ist isoliert; fällt eine
// aus, läuft der Build mit den übrigen weiter (graceful degradation).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchCpsc } from './lib/fetch-cpsc.js';
import { fetchManufacturers } from './lib/fetch-manufacturers.js';
import { fetchSafetyGate } from './lib/fetch-safetygate.js';
import { dedupe } from './lib/taxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'recalls.json');

const SOURCES = [
  { key: 'CPSC', label: 'US CPSC', fn: fetchCpsc },
  { key: 'Hersteller', label: 'Hersteller-Seiten', fn: fetchManufacturers },
  { key: 'SafetyGate', label: 'EU Safety Gate', fn: fetchSafetyGate },
];

function tally(arr, key) {
  const m = {};
  for (const r of arr) m[r[key]] = (m[r[key]] || 0) + 1;
  return m;
}

function sortRecords(a, b) {
  if (a.date && b.date) return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  if (a.date) return -1;
  if (b.date) return 1;
  return (a.title || '').localeCompare(b.title || '');
}

async function main() {
  const raw = [];
  const sourceStats = [];
  for (const s of SOURCES) {
    const t0 = Date.now();
    try {
      const recs = await s.fn();
      raw.push(...recs);
      sourceStats.push({ key: s.key, label: s.label, count: recs.length, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      console.error(`[build] Quelle ${s.key} fehlgeschlagen: ${e.stack || e.message}`);
      sourceStats.push({ key: s.key, label: s.label, count: 0, ok: false, error: String(e.message) });
    }
  }

  const deduped = dedupe(raw);

  // EU-Relevanz-Filter: behalte alle Nicht-CPSC-Einträge (Hersteller-Hubs &
  // EU Safety Gate sind EU/global) sowie CPSC-Einträge mit BEKANNTER, in Europa
  // verkaufter Marke (gleiche Produkte gelten in der EU). Verwirf US-/markenlose
  // CPSC-Treffer (z. B. Jagd-Baumsitz-Gurte, No-Name-Amazon).
  const isEuRelevant = (r) => r.source !== 'CPSC' || !!r.brandKey;
  const records = deduped.filter(isEuRelevant).sort(sortRecords);
  const droppedUsOnly = deduped.length - records.length;

  // Quellen-Zähler auf das TATSÄCHLICH angezeigte (gefilterte) Ergebnis ausrichten,
  // damit das Quellen-Status-Panel zu den Karten passt; Roh-Abrufzahl als .fetched.
  const groupOf = (src) => (src === 'CPSC' ? 'CPSC' : src === 'SafetyGate' ? 'SafetyGate' : 'Hersteller');
  const finalByGroup = {};
  for (const r of records) finalByGroup[groupOf(r.source)] = (finalByGroup[groupOf(r.source)] || 0) + 1;
  for (const s of sourceStats) {
    s.fetched = s.count;
    s.count = finalByGroup[s.key] || 0;
  }

  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      total: records.length,
      rawTotal: raw.length,
      scope: 'eu-relevant',
      droppedUsOnly,
      sources: sourceStats,
      bySource: tally(records, 'source'),
      byCategory: tally(records, 'category'),
      bySeverity: tally(records, 'severity'),
      disclaimer:
        'EU-relevante Auswahl: Rückrufe in Europa verkaufter Marken (Hersteller-' +
        'Rückrufseiten, EU Safety Gate sowie US-CPSC-Meldungen dieser Marken). ' +
        'Best-Effort-Aggregation öffentlicher Quellen, keine Gewähr für Vollständigkeit ' +
        'oder Aktualität – im Zweifel immer die offizielle Hersteller- bzw. Behördenmeldung prüfen.',
    },
    recalls: records,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\n[build] ${records.length} Rückrufe -> ${OUT}`);
  console.log(`[build] Quellen:`, sourceStats.map((s) => `${s.key}=${s.count}${s.ok ? '' : '(FEHLER)'}`).join('  '));
  console.log(`[build] Kategorien:`, data.meta.byCategory);

  if (records.length === 0) {
    console.error('[build] WARNUNG: 0 Rückrufe – Quellen prüfen.');
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('[build] Fataler Fehler:', e);
  process.exit(1);
});

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

  const records = dedupe(raw).sort(sortRecords);

  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      total: records.length,
      rawTotal: raw.length,
      sources: sourceStats,
      bySource: tally(records, 'source'),
      byCategory: tally(records, 'category'),
      bySeverity: tally(records, 'severity'),
      disclaimer:
        'Best-Effort-Aggregation öffentlicher Quellen (US CPSC, Hersteller-Rückrufseiten, ' +
        'EU Safety Gate). Keine Gewähr für Vollständigkeit oder Aktualität. Im Zweifel immer ' +
        'die offizielle Hersteller- bzw. Behördenmeldung prüfen.',
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

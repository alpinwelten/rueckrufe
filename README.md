# Rückruf-Radar

Ein Radar für Produktrückrufe rund um PSAgA, Bergsport und Arbeitssicherheit – aggregiert aus mehreren öffentlichen Quellen, als build-free PWA.

**Live:** https://alpinwelten.github.io/rueckrufe/

## Was es tut

Rückruf-Radar bündelt Produktrückrufe und Sicherheitshinweise zu **PSAgA** (PSA gegen Absturz), **Bergsport** und **Arbeitssicherheit** an einem Ort. Die Daten stammen aus drei Quellen:

- **US CPSC** – die REST-API der Consumer Product Safety Commission (`saferproducts.gov`), gefiltert nach Domänenbegriffen und bekannten Marken.
- **Hersteller-Rückrufseiten** – die Warnhinweis-/Safety-Alert-Hubs der Hersteller: **EDELRID** und **Climbing Technology** direkt, **Petzl**, **Mammut** und **SKYLOTEC** über den `r.jina.ai`-Proxy (JS-gerendert/bot-geschützt). Jeder Hub ist domain-gebunden (keine Fremdmarken-Fehlzuordnung).
- **EU Safety Gate** (RAPEX) – best-effort über den `r.jina.ai`-Proxy (siehe Grenzen unten).

Jeder Eintrag verlinkt auf die **Originalquelle** (`sourceUrl`) und – sofern die Marke erkannt wurde – zusätzlich auf die **Rückruf-/Sicherheitsseite des Herstellers** (`manufacturerUrl`).

## Architektur

Es gibt **kein** Live-Scraping im Browser. Ein **GitHub-Actions-Cron** (alle 6 h) holt die Quellen serverseitig, normalisiert und dedupliziert sie und committet das Ergebnis als statische `data/recalls.json`. Die PWA ist rein statisch und rendert nur diese Datei.

```
                 GitHub Actions (Cron, alle 6 h)
                            │
                            ▼
   ┌──────────┐   ┌──────────────────┐   ┌────────────────┐
   │ US CPSC  │   │ Hersteller-Hubs   │   │ EU Safety Gate │
   │ REST-API │   │ EDELRID·Petzl·CT· │   │ via r.jina.ai  │
   │          │   │ Mammut·SKYLOTEC   │   │                │
   └────┬─────┘   └────────┬─────────┘   └───────┬────────┘
        │                  │                     │
        └──────────────────┼─────────────────────┘
                           ▼
                 scripts/build.js
        (normalisieren · klassifizieren · dedupe · sortieren)
                           │
                           ▼
                 data/recalls.json   ← committed ins Repo
                           │
                           ▼
              statische PWA (GitHub Pages)
            Filter · Suche · Karten · Hersteller-Link
```

Fällt eine Quelle aus, läuft der Build mit den übrigen weiter (graceful degradation) – die fehlerhafte Quelle wird in `meta.sources` als `ok: false` vermerkt.

## Lokal entwickeln

Voraussetzung: **Node ≥ 20**, **keine Dependencies** (alles läuft mit der Node-Standardbibliothek).

```bash
# 1. Daten erzeugen (holt alle Quellen, schreibt data/recalls.json)
node scripts/build.js

# 2. Statischen Server starten
python3 -m http.server 8099

# 3. Im Browser öffnen
open http://localhost:8099
```

Der Build ist isoliert pro Quelle: schlägt z. B. der Hersteller-Scraper fehl, entstehen trotzdem Daten aus CPSC und Safety Gate.

## Datenquellen & Grenzen

Ehrlich bleibt ehrlich:

- **„Echtzeit" heißt Cron-Intervall.** Neue Rückrufe erscheinen erst nach dem nächsten Lauf (alle 6 h), nicht in dem Moment, in dem sie veröffentlicht werden.
- **CPSC ist stabil.** Offizielle, dokumentierte REST-API ohne Key; die zuverlässigste Quelle.
- **Hersteller-Scraper sind best-effort.** Sie extrahieren Detail-Links aus den Rückruf-Hubs und **können bei einem Seitenumbau brechen**. Tun sie das, liefern sie ein leeres Ergebnis, ohne den Build zu stoppen.
- **EU Safety Gate ist ein Workaround.** Die aktuelle Safety-Gate-API ist **POST-only hinter einer WAF**, die CI-Clients blockt. Wir lesen daher den gerenderten Such-Screen über den `r.jina.ai`-Proxy und filtern strikt auf unsere Marken/Kategorien – ausdrücklich best-effort und ggf. lückenhaft.
- **Keine Gewähr für Vollständigkeit oder Aktualität.** Im Zweifel immer die offizielle Hersteller- bzw. Behördenmeldung prüfen.

## Neue Marke / Quelle hinzufügen

**Neue Marke:** im `BRANDS`-Array in `scripts/lib/taxonomy.js` ergänzen (mit `name`, `home`, ggf. `recall` und `aliases`). Mehrdeutige Namen (z. B. „Camp", „Kong") mit `ambiguous: true` markieren – sie greifen dann nur in Kombination mit einem eindeutigen Domänenbegriff. Bei CPSC bei Bedarf zusätzlich in `BRAND_QUERIES` in `scripts/lib/fetch-cpsc.js` aufnehmen.

**Neue Hersteller-Rückrufseite:** Eintrag im `HUBS`-Array in `scripts/lib/fetch-manufacturers.js` (mit `url`, `linkRe` und optional `dateFromUrl`).

**Komplett neue Quelle:** ein neues `scripts/lib/fetch-*.js` schreiben, das ein Array normalisierter Recall-Objekte zurückgibt, und es im `SOURCES`-Array in `scripts/build.js` registrieren.

## Datenschema

Ein Recall-Objekt in `data/recalls.json`:

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `id` | string | Eindeutige ID, z. B. `CPSC:10774` |
| `source` / `sourceLabel` | string | Quell-Key bzw. Anzeigename |
| `date` | string\|null | `YYYY-MM-DD` |
| `manufacturer` | string | Rohname aus der Quelle |
| `title` | string | Titel des Rückrufs |
| `summary` | string | Gekürzte Beschreibung |
| `hazard` | string\|null | Art der Gefahr |
| `severity` | string | `high` · `medium` · `info` (Ampel) |
| `category` | string | `PSAgA` · `Bergsport` · `Arbeitssicherheit` · `Sonstiges` |
| `products` | string[] | Betroffene Produkte |
| `countries` | string[] | Ländercodes/-namen |
| `sourceUrl` | string\|null | Link zur Originalmeldung |
| `manufacturerName` | string\|null | Erkannte Marke |
| `manufacturerUrl` | string\|null | Rückruf-/Sicherheitsseite des Herstellers |
| `manufacturerHome` | string\|null | Hersteller-Startseite (Fallback) |
| `brandKey` | string\|null | interner Marken-Key |
| `images` | string[] | Bild-URLs |
| `sources` | object[] | Alle Quellen nach Dedup (`{ source, sourceLabel, url }`) |
| `reference` | string | (nur Safety Gate) Meldungsreferenz |

Daneben liegt ein `meta`-Block mit `generatedAt`, `total`, `rawTotal`, Quellen-Statistik (`sources`) sowie den Tallies `bySource`, `byCategory`, `bySeverity` und dem `disclaimer`.

## Deploy

Push auf `main` → GitHub Pages veröffentlicht die statischen Dateien. Der Cron-Workflow aktualisiert `data/recalls.json` automatisch (alle 6 h) und committet sie – die Live-Seite zieht damit ohne weiteres Zutun nach.

## Disclaimer

Rückruf-Radar ist eine **Best-Effort-Aggregation öffentlicher Quellen** (US CPSC, Hersteller-Rückrufseiten, EU Safety Gate). Es besteht **keine Gewähr für Vollständigkeit, Richtigkeit oder Aktualität**. Die Anzeige ersetzt keine offizielle Rückrufmeldung. Maßgeblich ist immer die Original-Meldung des jeweiligen Herstellers bzw. der zuständigen Behörde – im Zweifel dort prüfen.

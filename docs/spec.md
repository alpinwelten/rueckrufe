# Rückruf-Radar – Designdokument

**Datum:** 2026-06-14

Dieses Dokument beschreibt Ziel, Architektur und Datenmodell von Rückruf-Radar und bleibt dabei faktentreu zum tatsächlichen Code unter `scripts/`.

## Ziel & Scope

Rückruf-Radar aggregiert öffentlich zugängliche **Produktrückrufe und Sicherheitshinweise** für die Domänen

- **PSAgA** – Persönliche Schutzausrüstung gegen Absturz (Auffanggurte, Verbindungsmittel, Falldämpfer, Höhensicherungsgeräte …),
- **Bergsport** – Klettern, Bergsteigen, Klettersteig, Lawinensicherheit (Karabiner, Sicherungsgeräte, Steigeisen, Eisgeräte, Seile …),
- **Arbeitssicherheit** – Höhenarbeit / Rope Access / Industrieklettern,

und macht sie in einer einzigen, durchsuchbaren Oberfläche auffindbar. Jeder Eintrag verlinkt auf die Originalmeldung und – wenn die Marke erkannt wurde – auf die Rückruf-/Sicherheitsseite des Herstellers.

## Nicht-Ziele

- **Kein** Anspruch auf Vollständigkeit – es ist eine Best-Effort-Aggregation.
- **Kein** rechtsverbindlicher Rückruf-Dienst; maßgeblich bleibt die Originalmeldung.
- **Kein** Live-Scraping im Browser, kein Backend-Server, keine Datenbank.
- **Kein** Build-Schritt für das Frontend (build-free PWA) und **keine** npm-Dependencies.
- **Keine** Benachrichtigungen/Abos/Accounts – reine Lese-Oberfläche.

## Architektur

Zwei klar getrennte Hälften: eine serverseitige Datenpipeline und ein rein statisches Frontend.

```
  GitHub Actions (Cron, alle 6 h)              GitHub Pages (statisch)
  ┌────────────────────────────┐              ┌──────────────────────┐
  │ node scripts/build.js      │   commit     │ PWA liest             │
  │  → fetch CPSC / Hersteller │ ───────────▶ │ data/recalls.json     │
  │    / Safety Gate           │  recalls.json│ Filter·Suche·Karten   │
  │  → normalisieren · dedupe  │              └──────────────────────┘
  └────────────────────────────┘
```

**Warum kein Live-Scrape im Browser?** Die Quellen (CPSC, Safety Gate, Hersteller-Hubs) setzen **keine CORS-Header** für Cross-Origin-Fetches; ein Browser dürfte ihre Antworten gar nicht lesen. Außerdem wäre Scraping pro Seitenaufruf langsam, fragil und würde die Quellen unnötig belasten. Deshalb läuft das Holen serverseitig im Cron, das Ergebnis wird als statische JSON committet, und das Frontend lädt nur diese eine Datei – schnell, cachebar, offlinefähig.

## Datenquellen

### US CPSC – bestätigt als REST-JSON

`https://www.saferproducts.gov/RestWebServices/Recall?format=json`, ohne API-Key. Zwei Filter werden kombiniert (`scripts/lib/fetch-cpsc.js`):

- `ProductName=<Kategorie>` für Domänenbegriffe (`lanyard`, `carabiner`, `climbing`, `crampon`, `fall arrest` …),
- `RecallTitle=<Marke>` für Marken (die Titel lauten meist „<Marke> … Recalls …").

Treffer werden über `RecallID` dedupliziert; `helmet`/`pulley` sind bewusst **keine** Einzelabfragen (würden von Fahrradhelmen u. Ä. dominiert). Die zuverlässigste Quelle.

### EU Safety Gate – POST/WAF → Proxy, best-effort

Die aktuelle Safety-Gate-API (RAPEX) ist **POST-only hinter einer WAF**, die CI-Clients blockt. Workaround (`scripts/lib/fetch-safetygate.js`): die gerenderten Such-Screens

```
https://ec.europa.eu/safety-gate-alerts/screen/search?sortType=PUBLICATION_DATE_DESC&page=0|1
```

werden über den **`r.jina.ai`-Proxy** als Markdown abgerufen (der Proxy rendert die Angular-SPA wie ein echter Browser). Aus dem Markdown werden Links extrahiert und **strikt** auf bekannte Marken bzw. relevante Kategorien gefiltert. Ein Datum lässt sich aus dem gerenderten Text nicht zuverlässig ziehen (`date: null`). Ausdrücklich best-effort und ggf. lückenhaft.

### Hersteller-Hubs

Die Warnhinweis-/Safety-Alert-Übersichtsseiten der Hersteller (`scripts/lib/fetch-manufacturers.js`), aktuell:

- **EDELRID** – `https://edelrid.com/de-de/service/warnhinweis` (nur DE-Hub; der EN-Hub spiegelt dieselben Rückrufe),
- **Petzl** – `https://www.petzl.com/INT/en/Professional/safety-alerts` (Datum aus der URL, Muster `YYYY-M-D`).

Aus den Hubs werden Detail-Links per Regex (`linkRe`) extrahiert und zu Einträgen normalisiert. Best-effort: bricht eine Seite ihren Aufbau, liefert der Scraper `[]` zurück, ohne den Build zu gefährden.

## Datenpipeline & -schema

`scripts/build.js` orchestriert die Quellen aus dem `SOURCES`-Array. Jede Quelle ist isoliert in `try/catch` (graceful degradation); pro Quelle werden `count`, `ok` und Laufzeit in `meta.sources` protokolliert. Ablauf:

1. **Sammeln** – alle Quellen-Fetcher liefern normalisierte Recall-Objekte.
2. **Deduplizieren** – `dedupe()` aus `taxonomy.js` (siehe unten).
3. **Sortieren** – nach `date` absteigend; Einträge ohne Datum ans Ende, dann alphabetisch nach Titel.
4. **Schreiben** – `data/recalls.json` mit `meta` + `recalls`. Bei 0 Treffern `process.exitCode = 2` als Warnung.

Schema eines Recall-Objekts:

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `id` | string | z. B. `CPSC:10774`, `Petzl:<url>`, `SafetyGate:<ref|url>` |
| `source` / `sourceLabel` | string | Quell-Key bzw. Anzeigename |
| `date` | string\|null | `YYYY-MM-DD` |
| `manufacturer` | string | Rohname aus der Quelle |
| `title`, `summary`, `hazard` | string\|null | Titel, gekürzte Beschreibung, Gefahrenart |
| `severity` | enum | `high` · `medium` · `info` |
| `category` | enum | `PSAgA` · `Bergsport` · `Arbeitssicherheit` · `Sonstiges` |
| `products`, `countries`, `images` | string[] | betroffene Produkte / Länder / Bild-URLs |
| `sourceUrl` | string\|null | Originalmeldung |
| `manufacturerName`, `manufacturerUrl`, `manufacturerHome`, `brandKey` | string\|null | erkannte Marke + Links (Fallback: Hersteller-Startseite) |
| `sources` | object[] | nach Dedup gesammelte Quellen `{ source, sourceLabel, url }` |
| `reference` | string | nur Safety Gate: Meldungsreferenz (z. B. `A12/0318/13`) |

Der `meta`-Block enthält `generatedAt`, `total`, `rawTotal`, `sources`, die Tallies `bySource` / `byCategory` / `bySeverity` sowie den `disclaimer`.

## Taxonomie

Die gesamte Klassifikation lebt in `scripts/lib/taxonomy.js` und wird von allen Fetchern geteilt.

**Marken (`BRANDS`).** Verzeichnis von ~23 Herstellern (EDELRID, Petzl, Mammut, Black Diamond, Beal, CAMP, SKYLOTEC, DMM, Sterling, MSA, 3M, Honeywell …) mit `name`, `home`, optionaler `recall`-Seite und `aliases` (Schreibweisen, lowercase-Vergleich). `matchBrand()` erkennt Marken per **Ganzwort-Vergleich** im normalisierten Text (`normalizeBrandText()` entfernt Rechtsformen/Rauschwörter wie `inc`, `gmbh`, `equipment`).

- **`ambiguous`-Marken** (CAMP, KONG, Sterling, Tendon, MSA, 3M, Honeywell): mehrdeutige Namen, die nur akzeptiert werden, **wenn zusätzlich ein eindeutiger Domänenbegriff** vorkommt – sonst „Camp Chef", „Hong Kong" usw.
- **`denies`**: blockt explizite Fehltreffer (z. B. `hong kong` ≠ KONG).

**STRONG- vs. WEAK-Begriffe.**

- **STRONG** = eindeutige Domänenbegriffe (`fall arrest`, `lanyard`, `via ferrata`, `crampon`, `auffanggurt`, `klettersteig` …). Sie genügen **allein**, um einen Eintrag als relevant einzustufen.
- **WEAK** = mehrdeutige Begriffe (`harness`, `helmet`, `rope`, `connector`, `ppe` …). Sie zählen **nur dann**, wenn zusätzlich eine bekannte Marke erkannt wurde – sonst Fahrrad-/Baby-/Bauhelm-Lärm.

`isRelevant(text, hasBrand)` = ein STRONG-Begriff **oder** eine bekannte Marke.

**Kategorien.** `classifyCategory()` ordnet nach Priorität **PSAgA > Bergsport > Arbeitssicherheit** zu (zuerst STRONG, dann WEAK); kein Treffer → `Sonstiges`.

**Schweregrad-Ampel.** `classifySeverity()`:

- **`high`** (rot) – akute Gefahr / sofort stoppen (`fatal`, `death`, `stop using`, `lebensgefahr`, `tödlich`, `schwere verletzung` …),
- **`medium`** (gelb) – regulärer Rückruf (Wort `recall`/`rückruf`/`zurückgerufen`); auch der Default,
- **`info`** (grün/neutral) – Prüfung/Sicherheitshinweis (`safety check`, `inspection`, `sicherheitshinweis`, `warnhinweis` …).

## Deduplizierung

Quellenübergreifend über einen stabilen Schlüssel `dedupeKey()` = `brand | jahr | signifikante-wörter`, wobei die signifikanten Wörter aus Produkten/Titel normalisiert, auf Länge ≥ 4 gefiltert, sortiert und auf 6 begrenzt werden. `dedupe()` behält je Schlüssel den **reichhaltigsten** Eintrag und merged dabei:

- alle **Quellen** in `sources[]` (kein Verlust der Herkunft),
- die **längere** `summary`, vorhandene `images`, fehlende Hersteller-Links,
- die **höchste** `severity` (`high` > `medium` > `info`).

## Frontend

Statische PWA (build-free, Vanilla JS), die `data/recalls.json` lädt und rendert:

- **Filter** nach Kategorie (PSAgA / Bergsport / Arbeitssicherheit) und Schweregrad-Ampel,
- **Volltextsuche** über Titel, Hersteller und Produkte,
- **Karten** je Rückruf mit Schweregrad-Markierung, Datum, Produkten und ggf. Bild,
- **Quell-Link** (`sourceUrl`) plus **Hersteller-Link** (`manufacturerUrl`, Fallback `manufacturerHome`).

Die `meta`-Tallies eignen sich für eine kompakte Statuszeile (Anzahl je Quelle/Kategorie, Stand `generatedAt`).

## PWA / Offline

Web-App-Manifest und Icons (`icons/` – 192/512, maskable, Apple-Touch, Favicon) machen die App installierbar. Ein Service Worker cacht die statische Shell und die zuletzt geladene `data/recalls.json`, sodass die App offline mit dem letzten Stand lauffähig bleibt. `.nojekyll` verhindert die Jekyll-Verarbeitung auf GitHub Pages.

## CI / Deploy

- **Cron:** GitHub-Actions-Workflow (`.github/workflows/`), Intervall **alle 6 h**. Schritte: Node ≥ 20 einrichten → `node scripts/build.js` → bei Änderung `data/recalls.json` committen.
- **Deploy:** Push auf `main` veröffentlicht über GitHub Pages; da die App rein statisch ist, gibt es keinen Build-Schritt fürs Frontend. Der Cron-Commit der aktualisierten Daten triggert das Nachladen der Live-Seite automatisch.

## Grenzen & Best-Effort

- **„Echtzeit" = Cron-Intervall** (6 h), nicht der Moment der Veröffentlichung.
- **CPSC** stabil; **Hersteller-Scraper** können bei Seitenumbau brechen (dann leeres Ergebnis, kein Build-Abbruch).
- **Safety Gate** nur über Proxy erreichbar → best-effort, teils ohne Datum, teils lückenhaft.
- Robustheitsmaßnahmen: pro Quelle isoliertes `try/catch`, Timeouts + Retry + Browser-UA in `http.js`, höfliche Pausen (`sleep`) zwischen Requests, strikte Relevanz-/Marken-Filter gegen Rauschen.
- **Keine Gewähr** für Vollständigkeit/Aktualität – im Zweifel die Originalmeldung prüfen.

## Erweiterbarkeit

- **Neue Marke:** Eintrag in `BRANDS` (`taxonomy.js`); mehrdeutige Namen mit `ambiguous: true`, Fehltreffer per `denies`. Für CPSC ggf. `BRAND_QUERIES` (`fetch-cpsc.js`) ergänzen.
- **Neue Hersteller-Rückrufseite:** Eintrag in `HUBS` (`fetch-manufacturers.js`) mit `url`, `linkRe`, optional `dateFromUrl`.
- **Neue Quelle:** neues `scripts/lib/fetch-*.js` (gibt normalisierte Recall-Objekte zurück) + Registrierung im `SOURCES`-Array (`scripts/build.js`).
- **Neue Domänenbegriffe:** STRONG/WEAK-Listen in `taxonomy.js` pflegen.

---

**Erstellt:**

- `README.md` – Projekt-Übersicht (Zweck, Architektur, lokale Entwicklung, Quellen/Grenzen, Erweiterung, Schema, Deploy, Disclaimer).
- `docs/spec.md` – dieses Designdokument (Ziel/Scope, Nicht-Ziele, Architektur, Datenquellen, Pipeline/Schema, Taxonomie, Dedup, Frontend, PWA/Offline, CI/Deploy, Grenzen, Erweiterbarkeit).

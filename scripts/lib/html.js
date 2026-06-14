// html.js — abhängigkeitsfreie HTML-Helfer (Link-Extraktion, Entities, Tags).
const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü', '&Auml;': 'Ä',
  '&Ouml;': 'Ö', '&Uuml;': 'Ü', '&szlig;': 'ß', '&eacute;': 'é', '&ndash;': '–', '&mdash;': '—',
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Liefert [{ href, text }] aller <a>-Tags.
export function extractLinks(html) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push({ href: decodeEntities(m[1]), text: stripTags(m[2]) });
  }
  return out;
}

// Liefert [{ href, text }] aller Markdown-Links [Text](URL).
// Bild-Links (![alt](url)) werden übersprungen.
export function extractMarkdownLinks(md) {
  const out = [];
  const re = /\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    if (md[m.index - 1] === '!') continue; // Bild-Markdown auslassen
    out.push({ href: decodeEntities(m[2]), text: stripTags(m[1]) });
  }
  return out;
}

// Vereint <a>- und Markdown-Links (für HTML- wie Proxy-/Markdown-Inhalte).
export function extractAllLinks(content) {
  return [...extractLinks(content), ...extractMarkdownLinks(content)];
}

// Slug -> lesbarer Titel ("vorsorglicher-rueckruf" -> "Vorsorglicher Rueckruf").
// Robust gegen Query (?v=…), Dateiendung und eingebettete Shopify-UUIDs.
export function titleFromSlug(slug) {
  const last = String(slug || '').split('?')[0].split('/').filter(Boolean).pop() || '';
  const s = decodeURIComponent(last)
    .replace(/\.[a-z0-9]{2,4}$/i, '') // Dateiendung
    .replace(/[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '') // UUID
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function absUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

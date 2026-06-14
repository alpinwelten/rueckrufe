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

// Slug -> lesbarer Titel ("vorsorglicher-rueckruf" -> "Vorsorglicher Rueckruf").
export function titleFromSlug(slug) {
  const s = decodeURIComponent(String(slug || '').split('/').filter(Boolean).pop() || '')
    .replace(/\.[a-z]+$/i, '')
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

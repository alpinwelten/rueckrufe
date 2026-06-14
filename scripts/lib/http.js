// http.js — robuste fetch-Helfer mit Timeout, Retry und Browser-UA.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124 Safari/537.36';

export async function fetchText(url, { timeout = 30000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'de,en;q=0.8', ...headers },
        redirect: 'follow',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const txt = await fetchText(url, { headers: { Accept: 'application/json' }, ...opts });
  return JSON.parse(txt);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

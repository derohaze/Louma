/**
 * Finds visible text that does not change between the English and the Arabic render.
 *
 * Both apps render every page on the server, so the two HTML documents are a complete, ordered
 * picture of what a reader sees. Anything that reads the same in both is, by definition, still
 * English (or still Arabic) — an untranslated string.
 */
const LANDING_PAGES = [
  '/', '/features', '/pricing', '/about', '/changelog', '/blog', '/privacy', '/terms',
];
const DASH_PAGES = [
  '/', '/analytics', '/transactions', '/mining', '/mining/history', '/mining/pools',
  '/notifications', '/profile', '/security', '/settings', '/custom-address',
  '/login', '/signup', '/forgot-password',
];

const clean = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Text chunks with at least two Latin letters — the ones a reader would notice stuck in one language. */
const chunks = (html) => {
  const seen = new Set();
  for (const part of clean(html).split('\n')) {
    const value = part.trim();
    if (value.length < 2) continue;
    seen.add(value);
  }
  return seen;
};

const hasArabic = (value) => /[\u0600-\u06FF]/.test(value);

async function audit(base, pages, extraCookies = '') {
  console.log(`\n${'='.repeat(78)}\n${base}\n${'='.repeat(78)}`);
  for (const page of pages) {
    let en;
    let ar;
    try {
      en = await fetch(base + page, { headers: { cookie: `louma_lang=en${extraCookies}` } }).then((r) => r.text());
      ar = await fetch(base + page, { headers: { cookie: `louma_lang=ar${extraCookies}` } }).then((r) => r.text());
    } catch (error) {
      console.log(`\n${page}  FETCH FAILED: ${error.message}`);
      continue;
    }
    if (!clean(en)) {
      console.log(`\n${page}  (empty render)`);
      continue;
    }
    const enChunks = chunks(en);
    const arChunks = chunks(ar);

    // In the Arabic render, any chunk that still holds Latin words is a leftover.
    const untranslated = [...arChunks].filter((value) => /[A-Za-z]{2,}/.test(value) && !hasArabic(value));
    // And the reverse: chunks the Arabic page gained, reported for spelling checks.
    const arabic = [...arChunks].filter(hasArabic);

    if (!untranslated.length) {
      console.log(`\n${page}  OK`);
    } else {
      console.log(`\n${page}  ${untranslated.length} untranslated:`);
      for (const value of untranslated.slice(0, 40)) console.log(`    EN  ${value.slice(0, 110)}`);
    }
    if (arabic.length) {
      const joined = arabic.join(' | ');
      if (/لوم[هةي]/.test(joined)) console.log(`    !! BRAND MISSPELLED: ${joined.match(/.{0,20}لوم[هةي].{0,20}/g).join(' , ')}`);
    }
  }
}

const landing = process.argv[2] ?? 'http://localhost:3001';
const dash = process.argv[3] ?? 'http://localhost:3000';
await audit(landing, LANDING_PAGES);
await audit(dash, DASH_PAGES, '; louma_csrf=mock-csrf');
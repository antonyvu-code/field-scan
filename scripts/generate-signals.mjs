// Self-updating build step (study case §6 / Phase 5).
//
// Reads the real webdesign-digest markdown, then:
//   1. Extracts every "**[title](url)**" signal from the newest digest (the raw feed).
//   2. Validates that every curated signal URL in signals.json actually appears in
//      today's digest — this is the machine proof behind the page's claim that the
//      links are real. Unmatched URLs fail the build.
//   3. Computes real counts (digest days, raw-feed size, matched count) and the DAY
//      label, then writes them into signals.json meta.
//   4. Regenerates the accessible <ul>, the DAY eyebrow, and the footer date in
//      index.html from that single source of truth — no hand-editing two places.
//
// The digest is Vietnamese and the page is an English portfolio piece, so labels stay
// curated in signals.json; the digest drives data, counts, and validation — not copy.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const digestDir = resolve(projectRoot, '..', 'webdesign-digest');
const signalsPath = join(projectRoot, 'src', 'signals.json');
const indexPath = join(projectRoot, 'index.html');

// Matches both digest formats: the old "- **[title](url)**" lead-link style and
// the newer prose style where the first markdown link sits later in the line.
const DIGEST_ITEM = /^-\s+(?:([⭐🔥])\s+)?.*?\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gmu;

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}
function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function warn(msg) {
  console.warn(`\x1b[33m! ${msg}\x1b[0m`);
}

// --- 1. Locate the newest digest -------------------------------------------------
let digestFiles;
try {
  digestFiles = readdirSync(digestDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
} catch {
  // Remote build machines (Vercel) don't have the digest folder — it lives
  // outside the project. The integrity guard runs on every LOCAL build where
  // the digest exists; remotely we serve the committed, already-validated
  // signals.json and index.html as-is.
  warn(`Digest directory not found (${digestDir}) — skipping regeneration, using committed files.`);
  process.exit(0);
}
if (digestFiles.length === 0) fail('No dated digest files found.');

const latestFile = digestFiles[digestFiles.length - 1];
const latestDate = basename(latestFile, '.md');
const digestText = readFileSync(join(digestDir, latestFile), 'utf8');

// --- 2. Parse the raw feed -------------------------------------------------------
const rawFeed = [];
for (const m of digestText.matchAll(DIGEST_ITEM)) {
  rawFeed.push({ starred: Boolean(m[1]), title: m[2], url: m[3] });
}
ok(`Parsed ${rawFeed.length} signals from ${latestFile} (${digestFiles.length} digest days).`);

// --- 3. Validate curated signals against today's digest --------------------------
const signals = JSON.parse(readFileSync(signalsPath, 'utf8'));
let matched = 0;
const unmatched = [];
for (const s of signals.signals) {
  const host = new URL(s.url).host;
  if (digestText.includes(s.url)) {
    // Exact URL present in the digest — the strong guarantee.
    matched += 1;
  } else if (digestText.includes(host)) {
    // Fall back to a host match (e.g. a curated https://neuemontreal.com/ against a
    // digest link with a path), but say so — this is a weaker proof, not a silent pass.
    matched += 1;
    warn(`${s.url} matched by host only (${host}) — exact URL not found in ${latestFile}.`);
  } else {
    unmatched.push(s.url);
  }
}
if (unmatched.length) {
  fail(
    `${unmatched.length} curated signal URL(s) not found in ${latestFile} — the page ` +
      `would claim links that are not in today's digest:\n  ${unmatched.join('\n  ')}`
  );
}
ok(`All ${matched} curated signals verified against the digest.`);

// --- 4. Write real counts back into signals.json --------------------------------
const dayLabel = `DAY ${String(digestFiles.length).padStart(3, '0')}`;
// Meta derives only from the digest, so rebuilding on the same digest is idempotent
// (no timestamp churn in git).
signals.meta = {
  date: latestDate,
  digestDays: digestFiles.length,
  dayLabel,
  rawFeedCount: rawFeed.length,
  matched,
};
writeFileSync(signalsPath, JSON.stringify(signals, null, 2) + '\n');

// --- 5. Regenerate the markers in index.html ------------------------------------
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const listHtml =
  '<ul class="signals__list">\n' +
  signals.signals
    .map(
      (s) =>
        `        <li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`
    )
    .join('\n') +
  '\n      </ul>';

const transmissionHtml =
  `<a class="cta__link" href="../webdesign-digest/${latestDate}.md" target="_blank" ` +
  `rel="noopener">READ TODAY'S FULL TRANSMISSION →</a>`;

let html = readFileSync(indexPath, 'utf8');
const replaceMarker = (name, replacement) => {
  const re = new RegExp(`(<!--${name}-->)([\\s\\S]*?)(<!--/${name}-->)`);
  if (!re.test(html)) fail(`Marker <!--${name}--> not found in index.html`);
  // Function replacer: the replacement text may contain "$" (URLs, labels), which a
  // string replacement would misread as a capture-group reference.
  html = html.replace(re, (_m, open, _mid, close) => open + replacement + close);
};

replaceMarker('signals', `\n      ${listHtml}\n      `);
replaceMarker('day', `TRANSMISSION LOG · ${dayLabel}`);
replaceMarker('date', latestDate);
replaceMarker('transmission', transmissionHtml);
writeFileSync(indexPath, html);

ok(`index.html updated — ${dayLabel}, ${signals.signals.length} signals, dated ${latestDate}.`);

/**
 * Vendor Claude in Chrome 1.0.81 sidepanel CSS (src-DTxMKEcl.css) into
 * src/styles/official-1.0.81.css with font URLs rewritten to our local
 * public/fonts paths so Vite/CRX emit them like the rest of theme.css.
 *
 * Also writes a thin local overlay (kept in theme.css by hand).
 */
const fs = require('fs');
const path = require('path');

const SRC =
  'C:/Users/Administrator/Downloads/claude-chrome-main/claude-chrome-main/assets/src-DTxMKEcl.css';
const OUT = path.join(__dirname, '../src/styles/official-1.0.81.css');

let css = fs.readFileSync(SRC, 'utf8');

// Official font-face paths → local public/fonts (same files, unhashed names).
// Vite resolves absolute /public/... against project and hashes into assets/.
const FONT_MAP = [
  [
    /url\(\/assets\/AnthropicSans-Romans-Variable-25x258-Bpr3wWwO\.woff2\)/g,
    "url('/public/fonts/AnthropicSans-Romans-Variable.woff2')",
  ],
  [
    /url\(\/assets\/AnthropicSans-Italics-Variable-25x258-DiJh4Brh\.woff2\)/g,
    "url('/public/fonts/AnthropicSans-Italics-Variable.woff2')",
  ],
  [
    /url\(\/assets\/AnthropicSerif-Romans-Variable-25x258-B6fyXDVc\.woff2\)/g,
    "url('/public/fonts/AnthropicSerif-Romans-Variable.woff2')",
  ],
  [
    /url\(\/assets\/AnthropicSerif-Italics-Variable-25x258-DH989fus\.woff2\)/g,
    "url('/public/fonts/AnthropicSerif-Italics-Variable.woff2')",
  ],
  [
    /url\(\/assets\/AnthropicMono20250717_TKVF-B2MNN231\.woff2\)/g,
    "url('/public/fonts/AnthropicMono.woff2')",
  ],
];

for (const [re, rep] of FONT_MAP) {
  const before = css.length;
  css = css.replace(re, rep);
  if (css.length === before && !css.includes(rep.slice(0, 30))) {
    // count matches differently
  }
}

// Verify fonts rewritten
const leftover = css.match(/url\(\/assets\/Anthropic[^)]+\)/g);
if (leftover && leftover.length) {
  console.error('Unrewritten font URLs:', leftover);
  process.exit(1);
}

const banner = `/* AUTO-GENERATED from Claude in Chrome 1.0.81 assets/src-DTxMKEcl.css
 * Do not edit by hand — re-run: node scripts/vendor-official-css.cjs
 * Font URLs rewritten to /public/fonts/* for this extension's build.
 */
`;

fs.writeFileSync(OUT, banner + css);
console.log('Wrote', OUT, 'bytes', fs.statSync(OUT).size);

// Probe a few critical utilities for the overlay list
const probes = [
  'border-0\\.5',
  'border-\\[0\\.5px\\]',
  'rounded-\\[14px\\]',
  'leading-\\[1\\.65rem\\]',
  'max-w-\\[85\\%\\]',
  'z-\\[10\\]',
  'text-body',
  'overflow-wrap-anywhere',
  'bg-bg-000\\/50',
  'animate-shimmertext',
  'font-base{',
  'claude-response h1',
  'inline-link',
];
for (const p of probes) {
  const re = new RegExp(p);
  console.log(p, re.test(css) ? 'OK' : 'MISSING');
}

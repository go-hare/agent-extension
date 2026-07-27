/**
 * Build chrome-string locale JSON from official Claude Chrome i18n packs.
 * Maps hashed message ids → our stable keys in src/i18n/locales/*.json
 *
 * Official non-EN packs omit some EN-only hashes (Before you start, Cowork, …).
 * After mapping we fill misses from the EN pack so every locale file is complete;
 * runtime still layers EN_EXTRA / ZH_CN_EXTRA for self-hosted-only strings.
 */
import fs from 'node:fs';
import path from 'node:path';

const OFFICIAL =
  'C:/Users/Administrator/Downloads/claude-chrome-main/claude-chrome-main/i18n';
const OUT = path.resolve('src/i18n/locales');

/** Official hashed id → our key (plain string values only; plurals handled in code). */
const ID_MAP = {
  // core chrome
  'I4AiMx3dsz': 'clearChat',
  tKMlOcHz9T: 'menu',
  'D3idYvSLF9': 'settings',
  rHyMT1rizz: 'keyboardShortcut',
  y1Z3orIe9Z: 'language',
  XLcM6WHfQR: 'howCanIHelp',
  'fHClqd2+bS': 'typeSlashCommands',
  'l+dE/S7JbF': 'replyToClaude',
  'ycIOwbY8b/': 'askBeforeActing',
  LStwu4n1yT: 'actWithoutAsking',
  '9Bc5La8GAs': 'askBeforeActingDesc',
  'A+P9ROxKPP': 'actWithoutAskingDesc',
  gAR0atqpRn: 'working',
  '6x5YwESShd': 'waitingForPermission',
  Iufn28MeR1: 'hideSteps',
  '/CBk9UV8iS': 'newPermissionsRequired',
  O2tb5KUxpc: 'allowOnce',
  pvtgR26QWY: 'decline',
  K8niogJNQY: 'approvePlan',
  PSsQUhf180: 'makeChanges',
  'IjBl43b/I/': 'alwaysAllowSite',
  '6baLmoYEwS': 'browseClickType',
  '47FYwba+bI': 'cancel',
  'c0/oTKLaf+': 'skipPermissions',
  DcOPulvEDu: 'skipAllTitle',
  RIrR6dJyeb: 'warning',
  eDHTgRaIJG: 'optionsHeading',
  'X0ha1a+WYV': 'saveChanges',
  '7FAwwkYilD': 'shortcuts',
  cXAlMRerxW: 'scheduled',
  'NFf/0A3zf+': 'sectionPermissions',
  QXrOGus6PR: 'languageHint',
  '9qJKQKXInl': 'pinTitle',
  PqHH2BNESm: 'pinSubtitle',
  'o9QvTPY6E/': 'beforeYouStart',
  Kgfe412o2T: 'beforeYouStartRisk',
  acrOozm08x: 'beforeYouStartContinue',
  'zPbO6HcY5Z': 'permissionFooterRaw',
  '1cBbdp1n7Q': 'skipRisk3',
  xeH1mSU1MS: 'skipRisk2',
  AkXGCFumOh: 'claudeCowork',
  '1s5hdNRo4M': 'switchBackClassic',
  'RuX+iObJu9': 'tabGroupAccess',
  '5U/pkz4osv': 'automateRepetitive',
  iubKfx5Rzl: 'openSettings',
  IKoTMcBJ0H: 'settingsSaved',
  // Cowork / product surface (honest explainers still use our body copy)
  '1FUWJkTbi2': 'coworkOfficialHint',
  'SK2Ix/hhh7': 'coworkEmbedHint',
  Z2VDyqOU0z: 'coworkGoBeyond',
  SFuk1vRI4X: 'permission',
  xsy6u5jY4z: 'sitePermissionsDisabled',
  BfcxKxig7S: 'skipRisk4Link',
};

/** When official hash is EN-only, use a related translated hash if present. */
const FALLBACK_IDS = {
  // risk body: close cousins in non-EN packs
  beforeYouStartRisk: ['9anUl9Q74Z', 'RWrtnxjH8o', 'Kgfe412o2T'],
  // open settings → generic Settings label when dedicated string missing
  openSettings: ['iubKfx5Rzl', 'D3idYvSLF9'],
  beforeYouStartContinue: ['acrOozm08x', 'wVu1FLTwAn'],
  keyboardShortcut: ['rHyMT1rizz'],
  askBeforeActingDesc: ['9Bc5La8GAs'],
  actWithoutAskingDesc: ['A+P9ROxKPP'],
  beforeYouStart: ['o9QvTPY6E/'],
  claudeCowork: ['AkXGCFumOh', 'Z2VDyqOU0z'],
  switchBackClassic: ['1s5hdNRo4M'],
};

const LOCALES = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'es-ES',
  'es-419',
  'pt-BR',
  'it-IT',
  'ru-RU',
  'hi-IN',
  'id-ID',
];

fs.mkdirSync(OUT, { recursive: true });

function pick(pack, ids) {
  for (const id of ids) {
    const v = pack[id];
    if (typeof v === 'string' && v.length) return v;
  }
  return undefined;
}

const report = [];
const enPack = JSON.parse(fs.readFileSync(path.join(OFFICIAL, 'en-US.json'), 'utf8'));
const enOut = {};
for (const [id, key] of Object.entries(ID_MAP)) {
  const v = enPack[id];
  if (typeof v === 'string' && v.length) enOut[key] = v;
}
// EN fallbacks for keys only reached via FALLBACK_IDS
for (const [key, ids] of Object.entries(FALLBACK_IDS)) {
  if (!enOut[key]) {
    const v = pick(enPack, ids);
    if (v) enOut[key] = v;
  }
}

for (const loc of LOCALES) {
  const file = path.join(OFFICIAL, `${loc}.json`);
  if (!fs.existsSync(file)) {
    report.push(`MISSING pack ${loc}`);
    continue;
  }
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  let hit = 0;
  let miss = 0;
  let filled = 0;

  for (const [id, key] of Object.entries(ID_MAP)) {
    const v = pack[id];
    if (typeof v === 'string' && v.length) {
      out[key] = v;
      hit++;
    } else {
      miss++;
    }
  }

  // Related-hash fallbacks within the same locale
  for (const [key, ids] of Object.entries(FALLBACK_IDS)) {
    if (!out[key]) {
      const v = pick(pack, ids);
      if (v) {
        out[key] = v;
        filled++;
      }
    }
  }

  // Final: ensure complete key set from EN pack (no missing chrome keys)
  for (const [key, v] of Object.entries(enOut)) {
    if (!out[key]) {
      out[key] = v;
      filled++;
    }
  }

  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(path.join(OUT, `${loc}.json`), JSON.stringify(sorted, null, 2) + '\n');
  report.push(
    `${loc}: direct=${hit} miss=${miss} filled=${filled} keys=${Object.keys(sorted).length}`,
  );
}

console.log(report.join('\n'));
console.log('en-US key count', Object.keys(enOut).length);

// Apply native overrides for EN-only official hashes (Before you start, etc.)
try {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['scripts/patch-critical-locale-overrides.mjs'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.warn('warning: critical locale override patch failed');
  }
} catch (err) {
  console.warn('warning: could not run critical locale override patch', err);
}

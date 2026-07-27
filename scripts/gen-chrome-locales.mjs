/**
 * Generate Chrome Web Store / chrome.i18n _locales/<lang>/messages.json
 * for the full ~55 locale set used by Chromium extensions.
 *
 * App UI still uses the 14 official Claude packs under src/i18n/locales.
 * This script only covers extension listing strings (name, description,
 * action tooltip, command label).
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('_locales');

/** Chromium _locales directory names (55). */
const CHROME_LOCALES = [
  'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en_AU', 'en_GB',
  'en_US', 'es', 'es_419', 'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr',
  'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no',
  'pl', 'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te',
  'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW',
];

const EN = {
  extName: 'Claude for Chrome',
  extDescription:
    'Browser agent — reads pages and acts on your behalf, with per-action permissions.',
  actionTitle: 'Open Claude',
  commandTogglePanel: 'Toggle the Claude side panel',
};

/** Best-effort translations for locales we ship in the app UI packs. */
const BY_LOCALE = {
  en: EN,
  en_US: EN,
  en_GB: EN,
  en_AU: EN,
  zh_CN: {
    extName: 'Claude for Chrome',
    extDescription: '浏览器智能体 — 读取页面并代你操作，每次动作都需授权。',
    actionTitle: '打开 Claude',
    commandTogglePanel: '切换 Claude 侧栏',
  },
  zh_TW: {
    extName: 'Claude for Chrome',
    extDescription: '瀏覽器智慧代理 — 讀取頁面並代你操作，每次動作都需授權。',
    actionTitle: '開啟 Claude',
    commandTogglePanel: '切換 Claude 側欄',
  },
  ja: {
    extName: 'Claude for Chrome',
    extDescription:
      'ブラウザエージェント — ページを読み取り、操作ごとに許可を得て代行します。',
    actionTitle: 'Claude を開く',
    commandTogglePanel: 'Claude サイドパネルを切り替え',
  },
  ko: {
    extName: 'Claude for Chrome',
    extDescription:
      '브라우저 에이전트 — 페이지를 읽고 작업마다 권한을 받아 대신 수행합니다.',
    actionTitle: 'Claude 열기',
    commandTogglePanel: 'Claude 사이드 패널 전환',
  },
  de: {
    extName: 'Claude for Chrome',
    extDescription:
      'Browser-Agent — liest Seiten und handelt in Ihrem Namen, mit Freigabe pro Aktion.',
    actionTitle: 'Claude öffnen',
    commandTogglePanel: 'Claude-Seitenleiste umschalten',
  },
  fr: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agent de navigateur — lit les pages et agit pour vous, avec une autorisation par action.',
    actionTitle: 'Ouvrir Claude',
    commandTogglePanel: 'Basculer le panneau latéral Claude',
  },
  es: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agente del navegador: lee páginas y actúa por ti, con permiso por cada acción.',
    actionTitle: 'Abrir Claude',
    commandTogglePanel: 'Mostrar u ocultar el panel lateral de Claude',
  },
  es_419: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agente del navegador: lee páginas y actúa por ti, con permiso por cada acción.',
    actionTitle: 'Abrir Claude',
    commandTogglePanel: 'Mostrar u ocultar el panel lateral de Claude',
  },
  pt_BR: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agente do navegador — lê páginas e age por você, com permissão por ação.',
    actionTitle: 'Abrir Claude',
    commandTogglePanel: 'Alternar o painel lateral do Claude',
  },
  pt_PT: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agente do browser — lê páginas e age por si, com permissão por ação.',
    actionTitle: 'Abrir Claude',
    commandTogglePanel: 'Alternar o painel lateral do Claude',
  },
  it: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agente del browser — legge le pagine e agisce per te, con autorizzazione per ogni azione.',
    actionTitle: 'Apri Claude',
    commandTogglePanel: 'Attiva/disattiva il riquadro laterale di Claude',
  },
  ru: {
    extName: 'Claude for Chrome',
    extDescription:
      'Браузерный агент — читает страницы и действует от вашего имени с разрешением на каждое действие.',
    actionTitle: 'Открыть Claude',
    commandTogglePanel: 'Переключить боковую панель Claude',
  },
  hi: {
    extName: 'Claude for Chrome',
    extDescription:
      'ब्राउज़र एजेंट — पेज पढ़ता है और प्रत्येक क्रिया की अनुमति के साथ आपके लिए काम करता है।',
    actionTitle: 'Claude खोलें',
    commandTogglePanel: 'Claude साइड पैनल टॉगल करें',
  },
  id: {
    extName: 'Claude for Chrome',
    extDescription:
      'Agen browser — membaca halaman dan bertindak untuk Anda, dengan izin per tindakan.',
    actionTitle: 'Buka Claude',
    commandTogglePanel: 'Alihkan panel samping Claude',
  },
};

function messagesJson(strings) {
  return {
    extName: {
      message: strings.extName,
      description: 'Extension name shown in chrome://extensions and the toolbar.',
    },
    extDescription: {
      message: strings.extDescription,
      description: 'Extension description shown in chrome://extensions.',
    },
    actionTitle: {
      message: strings.actionTitle,
      description: 'Tooltip on the toolbar button.',
    },
    commandTogglePanel: {
      message: strings.commandTogglePanel,
      description: 'Label for the keyboard shortcut in chrome://extensions/shortcuts.',
    },
  };
}

// wipe & recreate so removed locales don't linger
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

let translated = 0;
let englishFallback = 0;
for (const loc of CHROME_LOCALES) {
  const strings = BY_LOCALE[loc] ?? EN;
  if (BY_LOCALE[loc]) translated++;
  else englishFallback++;
  const dir = path.join(OUT, loc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'messages.json'),
    JSON.stringify(messagesJson(strings), null, 2) + '\n',
  );
}

console.log(
  `Wrote ${CHROME_LOCALES.length} locales under _locales/ (translated=${translated}, en-fallback=${englishFallback})`,
);

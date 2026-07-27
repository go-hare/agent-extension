/**
 * Sidepanel / Options chrome strings.
 *
 * Official Claude in Chrome 1.0.81 ships 14 UI locale packs (~836 hashed keys).
 * We import the chrome subset generated into `./locales/*.json` (see
 * `scripts/gen-i18n-from-official.mjs`) and layer our own keys (API options,
 * verbs, empty-state chips) that the official pack doesn't cover.
 */

import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import deDE from './locales/de-DE.json';
import frFR from './locales/fr-FR.json';
import esES from './locales/es-ES.json';
import es419 from './locales/es-419.json';
import ptBR from './locales/pt-BR.json';
import itIT from './locales/it-IT.json';
import ruRU from './locales/ru-RU.json';
import hiIN from './locales/hi-IN.json';
import idID from './locales/id-ID.json';

export type UiLocale =
  | 'en-US'
  | 'zh-CN'
  | 'zh-TW'
  | 'ja-JP'
  | 'ko-KR'
  | 'de-DE'
  | 'fr-FR'
  | 'es-ES'
  | 'es-419'
  | 'pt-BR'
  | 'it-IT'
  | 'ru-RU'
  | 'hi-IN'
  | 'id-ID';

type Pack = Record<string, string>;

const PACKS: Record<UiLocale, Pack> = {
  'en-US': enUS as Pack,
  'zh-CN': zhCN as Pack,
  'zh-TW': zhTW as Pack,
  'ja-JP': jaJP as Pack,
  'ko-KR': koKR as Pack,
  'de-DE': deDE as Pack,
  'fr-FR': frFR as Pack,
  'es-ES': esES as Pack,
  'es-419': es419 as Pack,
  'pt-BR': ptBR as Pack,
  'it-IT': itIT as Pack,
  'ru-RU': ruRU as Pack,
  'hi-IN': hiIN as Pack,
  'id-ID': idID as Pack,
};

export const UI_LOCALES: Array<{ id: UiLocale; label: string }> = [
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'ko-KR', label: '한국어' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'es-ES', label: 'Español' },
  { id: 'es-419', label: 'Español (Latinoamérica)' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'it-IT', label: 'Italiano' },
  { id: 'ru-RU', label: 'Русский' },
  { id: 'hi-IN', label: 'हिन्दी' },
  { id: 'id-ID', label: 'Bahasa Indonesia' },
];

export type UiStrings = {
  sidepanelTitle: string;
  optionsTitle: string;
  productName: string;

  clearChat: string;
  menu: string;
  settings: string;
  keyboardShortcut: string;
  language: string;
  openSettingsEllipsis: string;
  chooseModel: string;
  noModelsYet: string;
  modelSelectorAria: (model: string) => string;

  emptyGreeting: string;
  emptyNeedSetup: string;
  openSettings: string;
  suggestionSummarize: string;
  suggestionPricing: string;
  suggestionForm: string;

  howCanIHelp: string;
  typeSlashCommands: string;
  replyToClaude: string;
  answerPermissionAbove: string;
  askBeforeActing: string;
  actWithoutAsking: string;
  askBeforeActingDesc: string;
  actWithoutAskingDesc: string;
  attachFiles: string;
  sendMessage: string;
  stopMessage: string;
  permissionModeAria: (label: string) => string;

  working: string;
  waitingForPermission: string;
  stepsOne: string;
  stepsMany: (n: number) => string;

  newPermissionsRequired: string;
  permission: string;
  claudeWantsTo: (verb: string) => string;
  claudeWantsApproval: string;
  allowOnce: string;
  decline: string;
  approvePlan: string;
  makeChanges: string;
  alwaysAllowSite: string;
  browseClickType: string;
  sitePermissionsDisabled: string;
  permissionFooter: string;
  settingsLink: string;
  allowedOnce: string;
  allowedRemembered: string;
  declined: string;

  verbRead: string;
  verbClick: string;
  verbType: string;
  verbNavigate: string;
  verbJs: string;
  verbUpload: string;
  verbConsole: string;
  verbNetwork: string;
  verbPlan: string;
  verbAct: string;

  skipAllTitle: string;
  warning: string;
  skipRisk1: string;
  skipRisk2: string;
  skipRisk3: string;
  skipRisk4Before: string;
  skipRisk4Link: string;
  skipRisk4After: string;
  cancel: string;
  skipPermissions: string;

  hideSteps: string;
  stepOne: string;
  stepsCount: (n: number) => string;

  optionsHeading: string;
  optionsIntro: string;
  sectionApi: string;
  sectionApiNote: string;
  sectionWhere: string;
  sectionWhereNote: string;
  sectionCapabilities: string;
  sectionAppearance: string;
  sectionPermissions: string;
  sectionPermissionsNote: string;
  sectionShortcuts: string;
  sectionShortcutsNote: string;
  sectionSchedules: string;
  sectionSchedulesNote: string;
  languageHint: string;
  theme: string;
  saveChanges: string;
  discard: string;
  saved: string;
  unsaved: string;

  pinTitle: string;
  pinSubtitle: string;
  pinDismiss: string;
  beforeYouStart: string;
  beforeYouStartRisk: string;
  beforeYouStartContinue: string;
  tabGroupAccess: string;
  tabGroupAccessBody: string;
  automateRepetitive: string;
  claudeCowork: string;
  switchBackClassic: string;
  coworkUnavailableTitle: string;
  coworkUnavailableBody: string;
  coworkOpenClaudeAi: string;
  pairingTitle: string;
  pairingBody: string;
  pairingGotIt: string;

  /** Teach Claude / Record workflow */
  teachClaude: string;
  teachYourWorkflow: string;
  teachIntroBody: string;
  teachStartRecording: string;
  teachRecording: string;
  teachPaused: string;
  teachPause: string;
  teachResume: string;
  teachStop: string;
  teachVoice: string;
  teachVoiceOn: string;
  teachClickHint: string;
  teachStep: string;
  teachSteps: string;
  teachSaveTitle: string;
  teachNameLabel: string;
  teachSaveAndRun: string;
  teachSaveOnly: string;
  teachDefaultTitle: string;
  teachNeedPage: string;
  teachNoSteps: string;
  teachSpeechUnsupported: string;
  teachShortcutDesc: (n: number) => string;
  teachSlashDesc: string;
  suggestionTeach: string;
  teachExportGif: (n: number) => string;
  teachExporting: string;
  teachGifSaved: (n: number) => string;
  teachNoFrames: string;
  /** Options — Teach Claude / speech section */
  sectionTeach: string;
  sectionTeachNote: string;
  teachSpeechEnable: string;
  teachSpeechEnableHint: string;
  teachSpeechLangLabel: string;
  teachSpeechLangHint: string;
  teachCaptureFramesLabel: string;
  teachCaptureFramesHint: string;
};

/** Keys not present (or incomplete) in official non-EN packs — English base. */
const EN_EXTRA: Pack = {
  sidepanelTitle: 'Claude for Chrome',
  optionsTitle: 'Claude Options',
  productName: 'Claude for Chrome',
  openSettingsEllipsis: 'Open settings…',
  chooseModel: 'Choose a model',
  noModelsYet: 'No models loaded yet.',
  emptyGreeting: "Hi, I'm Claude. How can I help you today?",
  emptyNeedSetup: 'Set up your API connection to start',
  suggestionSummarize: 'Summarize this page',
  suggestionPricing: 'Find the pricing on this site',
  suggestionForm: 'Fill in this form with my details',
  answerPermissionAbove: 'Answer the permission request above',
  attachFiles: 'Attach files',
  sendMessage: 'Send message',
  stopMessage: 'Stop message',
  permission: 'Permission',
  claudeWantsApproval: 'Claude wants your approval to:',
  sitePermissionsDisabled: 'Site-level permissions are disabled for this site.',
  permissionFooter:
    'Claude will not purchase items, create accounts, or bypass captchas without input. Revoke site permissions in',
  settingsLink: 'settings',
  allowedOnce: 'Allowed once.',
  allowedRemembered: 'Allowed — and remembered for this site.',
  declined: 'Declined.',
  verbRead: 'read this page',
  verbClick: 'click',
  verbType: 'type',
  verbNavigate: 'navigate',
  verbJs: 'run JavaScript',
  verbUpload: 'upload a file',
  verbConsole: 'read the console',
  verbNetwork: 'inspect network traffic',
  verbPlan: 'follow a plan',
  verbAct: 'act',
  skipRisk1: 'This allows Claude to take any action on the internet.',
  skipRisk2: 'This mode puts your data and the data of others at risk from malicious code.',
  skipRisk4Before: 'Review',
  skipRisk4Link: 'risks',
  skipRisk4After: 'before you begin.',
  stepOne: '1 step',
  optionsIntro:
    'This extension talks to an Anthropic-compatible endpoint that you choose. Nothing is sent anywhere else.',
  sectionApi: 'API connection',
  sectionApiNote:
    'Point this at your own relay. The extension appends /v1 itself — enter the root URL.',
  sectionWhere: 'Where the agent may act',
  sectionWhereNote: 'Leave the allow-list empty to permit any site. The block-list always wins.',
  sectionCapabilities: 'Capabilities',
  sectionAppearance: 'Appearance',
  sectionPermissionsNote:
    'Sites where you chose “Always allow”. Revoking takes effect immediately.',
  sectionShortcutsNote:
    'Type / in the chat to use shortcuts or run them on schedule. Seed entries are created on first open.',
  sectionSchedulesNote:
    'Runs only when the side panel is open. If closed, you get a notification — this is not unattended automation.',
  theme: 'Theme',
  discard: 'Discard',
  unsaved: 'Unsaved changes',
  pinDismiss: 'Got it',
  beforeYouStartContinue: 'Continue',
  tabGroupAccessBody:
    'When your current tab is in a group, Claude only lists and acts on tabs in that group.',
  coworkUnavailableTitle: 'Claude Cowork',
  coworkUnavailableBody:
    'The official Cowork side panel embeds claude.ai account chat. This build runs the classic browser agent against your own API key — no Anthropic login required.',
  coworkOpenClaudeAi: 'Open claude.ai',
  pairingTitle: 'Browser already connected',
  pairingBody:
    'Official pairing links Claude Desktop / claude.ai to the browser extension. Here the side panel is the agent — configure your API key in Settings and start chatting. No pairing code is needed.',
  pairingGotIt: 'Got it',
  // fallbacks if pack miss
  keyboardShortcut: 'Keyboard shortcut',
  askBeforeActingDesc: 'Claude plans its approach before taking actions.',
  actWithoutAskingDesc: 'Claude works without pausing for approval.',
  beforeYouStart: 'Before you start',
  beforeYouStartRisk:
    'Claude in Chrome can take actions in your browser on your behalf. This carries unique risks distinct from other Claude products. You are responsible for actions taken in your browser.',
  claudeCowork: 'Claude Cowork',
  switchBackClassic: 'Switch back to classic',
  openSettings: 'Open settings',
  sectionShortcuts: 'Shortcuts',
  sectionSchedules: 'Scheduled',
  // Teach Claude
  teachClaude: 'Teach Claude',
  teachYourWorkflow: 'Teach Claude your workflow',
  teachIntroBody:
    'Show Claude how you work by clicking through the steps. Claude will turn them into a reusable shortcut.',
  teachStartRecording: 'Start recording',
  teachRecording: 'Recording',
  teachPaused: 'Paused',
  teachPause: 'Pause',
  teachResume: 'Resume',
  teachStop: 'Stop',
  teachVoice: 'Voice',
  teachVoiceOn: 'Listening…',
  teachClickHint: 'Click elements on the page to record steps.',
  teachStep: 'step',
  teachSteps: 'steps',
  teachSaveTitle: 'Save workflow',
  teachNameLabel: 'Name',
  teachSaveAndRun: 'Save & run',
  teachSaveOnly: 'Save only',
  teachDefaultTitle: 'Recorded workflow',
  teachNeedPage:
    'Open a normal web page (not chrome:// or the store) so clicks can be recorded.',
  teachNoSteps: 'Record at least one step before saving.',
  teachSpeechUnsupported: 'Speech recognition is not available in this browser.',
  teachSlashDesc: 'Demonstrate a workflow by clicking on the page, then save it as a shortcut.',
  suggestionTeach: 'Teach Claude a workflow',
  teachExporting: 'Exporting…',
  teachNoFrames: 'No frames captured. Enable frame capture in Options to export a GIF.',
  // Options — Teach Claude
  sectionTeach: 'Teach Claude',
  sectionTeachNote: 'Recording options for the Teach Claude / Record workflow feature.',
  teachSpeechEnable: 'Start voice transcription automatically when recording',
  teachSpeechEnableHint: 'You can still toggle the microphone on the recording bar.',
  teachSpeechLangLabel: 'Speech recognition language',
  teachSpeechLangHint: 'BCP-47 tag (e.g. en-US, zh-CN). Leave empty to follow the interface language.',
  teachCaptureFramesLabel: 'Capture page frames during recording (for GIF export)',
  teachCaptureFramesHint: 'Takes a screenshot per step so you can export the session as an animated GIF.',
};

const ZH_CN_EXTRA: Pack = {
  optionsTitle: 'Claude 选项',
  openSettingsEllipsis: '打开设置…',
  chooseModel: '选择模型',
  noModelsYet: '尚未加载模型。',
  emptyGreeting: '你好，我是 Claude。今天我能为您做些什么？',
  emptyNeedSetup: '请先配置 API 连接以开始使用',
  suggestionSummarize: '总结此页面',
  suggestionPricing: '查找此网站的价格信息',
  suggestionForm: '用我的信息填写此表单',
  answerPermissionAbove: '请先回答上方的权限请求',
  attachFiles: '附加文件',
  sendMessage: '发送消息',
  stopMessage: '停止',
  permission: '权限',
  claudeWantsApproval: 'Claude 需要您批准：',
  sitePermissionsDisabled: '此网站已禁用站点级权限。',
  permissionFooter: '未经输入，Claude 不会购买商品、创建账户或绕过验证码。在',
  settingsLink: '设置',
  allowedOnce: '已允许一次。',
  allowedRemembered: '已允许 — 并已记住此网站。',
  declined: '已拒绝。',
  verbRead: '读取此页面',
  verbClick: '点击',
  verbType: '输入',
  verbNavigate: '导航',
  verbJs: '运行 JavaScript',
  verbUpload: '上传文件',
  verbConsole: '读取控制台',
  verbNetwork: '检查网络流量',
  verbPlan: '执行计划',
  verbAct: '操作',
  skipRisk1: '这将允许 Claude 在互联网上执行任何操作。',
  skipRisk2: '此模式会使您的数据以及他人的数据面临恶意代码风险。',
  skipRisk4Before: '开始前请查看',
  skipRisk4Link: '风险说明',
  skipRisk4After: '。',
  stepOne: '1 步',
  optionsIntro: '此扩展连接到您选择的 Anthropic 兼容接口。不会发送到其他地方。',
  sectionApi: 'API 连接',
  sectionApiNote: '指向您自己的中转。扩展会自行追加 /v1 — 请填写根 URL。',
  sectionWhere: '可操作的范围',
  sectionWhereNote: '允许列表留空表示不限制站点。阻止列表始终优先。',
  sectionCapabilities: '功能',
  sectionAppearance: '外观',
  sectionPermissionsNote: '您选择“始终允许”的网站。撤销立即生效。',
  sectionShortcutsNote: '在聊天中输入 / 使用快捷指令，或按计划运行。首次打开会创建示例。',
  sectionSchedulesNote: '仅在侧栏打开时运行。若关闭，会收到通知 — 这不是无人值守自动化。',
  theme: '主题',
  discard: '放弃',
  unsaved: '有未保存的更改',
  pinDismiss: '知道了',
  beforeYouStartContinue: '继续',
  tabGroupAccessBody: '当前标签页在分组内时，Claude 只会列出并操作该分组中的标签页。',
  coworkUnavailableTitle: 'Claude Cowork',
  coworkUnavailableBody:
    '官方 Cowork 侧栏会嵌入 claude.ai 账号聊天。本构建使用经典浏览器智能体 + 您自己的 API Key，无需 Anthropic 登录。',
  coworkOpenClaudeAi: '打开 claude.ai',
  pairingTitle: '浏览器已连接',
  pairingBody:
    '官方配对用于把 Claude Desktop / claude.ai 连到浏览器扩展。这里侧栏本身就是智能体 — 在设置中配置 API Key 后即可对话，无需配对码。',
  pairingGotIt: '知道了',
  keyboardShortcut: '键盘快捷键',
  askBeforeActingDesc: 'Claude 会在采取行动前先规划方法。',
  actWithoutAskingDesc: 'Claude 会在不暂停征求批准的情况下工作。',
  // Override EN-only official hashes that gen-i18n fills with English:
  beforeYouStart: '开始之前',
  beforeYouStartRisk:
    'Claude in Chrome 可以代表您在浏览器中执行操作。这与其他 Claude 产品有不同的独特风险。您需对浏览器中采取的操作负责。',
  claudeCowork: 'Claude Cowork',
  switchBackClassic: '切回经典版',
  openSettings: '打开设置',
  // Teach Claude
  teachClaude: '教 Claude',
  teachYourWorkflow: '把你的流程教给 Claude',
  teachIntroBody: '在页面上逐步点击演示，Claude 会把这些步骤保存成可复用的快捷指令。',
  teachStartRecording: '开始录制',
  teachRecording: '录制中',
  teachPaused: '已暂停',
  teachPause: '暂停',
  teachResume: '继续',
  teachStop: '停止',
  teachVoice: '语音',
  teachVoiceOn: '聆听中…',
  teachClickHint: '在页面上点击元素以记录步骤。',
  teachStep: '步',
  teachSteps: '步',
  teachSaveTitle: '保存工作流',
  teachNameLabel: '名称',
  teachSaveAndRun: '保存并运行',
  teachSaveOnly: '仅保存',
  teachDefaultTitle: '已录制的工作流',
  teachNeedPage: '请打开普通网页（不要使用 chrome:// 或商店页），才能录制点击。',
  teachNoSteps: '保存前请至少录制一步。',
  teachSpeechUnsupported: '当前浏览器不支持语音识别。',
  teachSlashDesc: '通过在页面上点击演示流程，并保存为快捷指令。',
  suggestionTeach: '教 Claude 一个流程',
  teachExporting: '导出中…',
  teachNoFrames: '未捕获任何帧。请在设置中开启帧捕获以导出 GIF。',
  sectionTeach: '教 Claude',
  sectionTeachNote: '「教 Claude / 录制工作流」功能的录制选项。',
  teachSpeechEnable: '录制时自动开始语音转写',
  teachSpeechEnableHint: '你仍可在录制栏上随时开关麦克风。',
  teachSpeechLangLabel: '语音识别语言',
  teachSpeechLangHint: 'BCP-47 标签（如 en-US、zh-CN）。留空则跟随界面语言。',
  teachCaptureFramesLabel: '录制时捕获页面帧（用于导出 GIF）',
  teachCaptureFramesHint: '每个步骤截图一次，便于将会话导出为动态 GIF。',
};

/**
 * Official non-EN packs omit several EN-only hashes (Before you start, keyboard
 * shortcut, Switch back to classic, permission-mode descriptions, …). gen-i18n
 * fills those from EN so packs are complete; these overrides stop the English
 * leak on first-run / menu chrome for every UI locale we ship.
 */
const CRITICAL_OVERRIDES: Partial<Record<UiLocale, Pack>> = {
  'zh-CN': {
    beforeYouStart: '开始之前',
    beforeYouStartRisk:
      'Claude in Chrome 可以代表您在浏览器中执行操作。这与其他 Claude 产品有不同的独特风险。您需对浏览器中采取的操作负责。',
    beforeYouStartContinue: '继续',
    keyboardShortcut: '键盘快捷键',
    askBeforeActingDesc: 'Claude 会在采取行动前先规划方法。',
    actWithoutAskingDesc: 'Claude 会在不暂停征求批准的情况下工作。',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: '切回经典版',
    openSettings: '打开设置',
    pinDismiss: '知道了',
  },
  'zh-TW': {
    beforeYouStart: '開始之前',
    beforeYouStartRisk:
      'Claude in Chrome 可以代表您在瀏覽器中執行操作。這與其他 Claude 產品有不同的獨特風險。您需對瀏覽器中採取的操作負責。',
    beforeYouStartContinue: '繼續',
    keyboardShortcut: '鍵盤快速鍵',
    askBeforeActingDesc: 'Claude 會在採取行動前先規劃方法。',
    actWithoutAskingDesc: 'Claude 會在不暫停徵求批准的情況下工作。',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: '切回經典版',
    openSettings: '開啟設定',
    pinDismiss: '知道了',
  },
  'ja-JP': {
    beforeYouStart: '始める前に',
    beforeYouStartRisk:
      'Claude in Chrome は、お客様に代わってブラウザ上で操作できます。他の Claude 製品とは異なる固有のリスクがあります。ブラウザで行われた操作についてはお客様が責任を負います。',
    beforeYouStartContinue: '続ける',
    keyboardShortcut: 'キーボードショートカット',
    askBeforeActingDesc: 'Claude は行動する前に方針を計画します。',
    actWithoutAskingDesc: 'Claude は承認を待たずに作業を進めます。',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'クラシックに戻る',
    openSettings: '設定を開く',
    pinDismiss: '了解',
  },
  'ko-KR': {
    beforeYouStart: '시작하기 전에',
    beforeYouStartRisk:
      'Claude in Chrome은 사용자를 대신해 브라우저에서 작업을 수행할 수 있습니다. 다른 Claude 제품과 다른 고유한 위험이 있습니다. 브라우저에서 수행된 작업에 대한 책임은 사용자에게 있습니다.',
    beforeYouStartContinue: '계속',
    keyboardShortcut: '키보드 단축키',
    askBeforeActingDesc: 'Claude가 행동을 취하기 전에 접근 방식을 계획합니다.',
    actWithoutAskingDesc: 'Claude가 승인 없이 작업을 진행합니다.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: '클래식으로 돌아가기',
    openSettings: '설정 열기',
    pinDismiss: '확인',
  },
  'de-DE': {
    beforeYouStart: 'Bevor Sie beginnen',
    beforeYouStartRisk:
      'Claude in Chrome kann Aktionen in Ihrem Browser in Ihrem Namen ausführen. Das birgt besondere Risiken, die sich von anderen Claude-Produkten unterscheiden. Sie sind für Aktionen in Ihrem Browser verantwortlich.',
    beforeYouStartContinue: 'Weiter',
    keyboardShortcut: 'Tastenkürzel',
    askBeforeActingDesc: 'Claude plant den Ansatz, bevor Aktionen ausgeführt werden.',
    actWithoutAskingDesc: 'Claude arbeitet, ohne auf Freigaben zu warten.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Zurück zur klassischen Ansicht',
    openSettings: 'Einstellungen öffnen',
    pinDismiss: 'Verstanden',
  },
  'fr-FR': {
    beforeYouStart: 'Avant de commencer',
    beforeYouStartRisk:
      'Claude in Chrome peut effectuer des actions dans votre navigateur en votre nom. Cela comporte des risques distincts des autres produits Claude. Vous êtes responsable des actions réalisées dans votre navigateur.',
    beforeYouStartContinue: 'Continuer',
    keyboardShortcut: 'Raccourci clavier',
    askBeforeActingDesc: 'Claude planifie son approche avant d’agir.',
    actWithoutAskingDesc: 'Claude travaille sans s’arrêter pour demander une approbation.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Revenir au classique',
    openSettings: 'Ouvrir les paramètres',
    pinDismiss: 'Compris',
  },
  'es-ES': {
    beforeYouStart: 'Antes de empezar',
    beforeYouStartRisk:
      'Claude in Chrome puede realizar acciones en tu navegador en tu nombre. Esto conlleva riesgos distintos de otros productos de Claude. Eres responsable de las acciones realizadas en tu navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atajo de teclado',
    askBeforeActingDesc: 'Claude planifica su enfoque antes de actuar.',
    actWithoutAskingDesc: 'Claude trabaja sin detenerse para pedir aprobación.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Volver al clásico',
    openSettings: 'Abrir configuración',
    pinDismiss: 'Entendido',
  },
  'es-419': {
    beforeYouStart: 'Antes de empezar',
    beforeYouStartRisk:
      'Claude in Chrome puede realizar acciones en tu navegador en tu nombre. Esto conlleva riesgos distintos de otros productos de Claude. Eres responsable de las acciones realizadas en tu navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atajo de teclado',
    askBeforeActingDesc: 'Claude planifica su enfoque antes de actuar.',
    actWithoutAskingDesc: 'Claude trabaja sin detenerse para pedir aprobación.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Volver al clásico',
    openSettings: 'Abrir configuración',
    pinDismiss: 'Entendido',
  },
  'pt-BR': {
    beforeYouStart: 'Antes de começar',
    beforeYouStartRisk:
      'O Claude in Chrome pode realizar ações no seu navegador em seu nome. Isso traz riscos distintos de outros produtos Claude. Você é responsável pelas ações realizadas no navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atalho de teclado',
    askBeforeActingDesc: 'O Claude planeja a abordagem antes de agir.',
    actWithoutAskingDesc: 'O Claude trabalha sem pausar para pedir aprovação.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Voltar ao clássico',
    openSettings: 'Abrir configurações',
    pinDismiss: 'Entendi',
  },
  'it-IT': {
    beforeYouStart: 'Prima di iniziare',
    beforeYouStartRisk:
      'Claude in Chrome può compiere azioni nel browser per tuo conto. Ciò comporta rischi distinti da altri prodotti Claude. Sei responsabile delle azioni compiute nel browser.',
    beforeYouStartContinue: 'Continua',
    keyboardShortcut: 'Scorciatoia da tastiera',
    askBeforeActingDesc: 'Claude pianifica l’approccio prima di agire.',
    actWithoutAskingDesc: 'Claude lavora senza fermarsi per chiedere l’approvazione.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Torna al classico',
    openSettings: 'Apri impostazioni',
    pinDismiss: 'Ho capito',
  },
  'ru-RU': {
    beforeYouStart: 'Перед началом',
    beforeYouStartRisk:
      'Claude in Chrome может выполнять действия в браузере от вашего имени. Это сопряжено с особыми рисками, отличными от других продуктов Claude. Вы несёте ответственность за действия в браузере.',
    beforeYouStartContinue: 'Продолжить',
    keyboardShortcut: 'Сочетание клавиш',
    askBeforeActingDesc: 'Claude планирует подход перед выполнением действий.',
    actWithoutAskingDesc: 'Claude работает, не останавливаясь за подтверждением.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Вернуться к классике',
    openSettings: 'Открыть настройки',
    pinDismiss: 'Понятно',
  },
  'hi-IN': {
    beforeYouStart: 'शुरू करने से पहले',
    beforeYouStartRisk:
      'Claude in Chrome आपके बदले ब्राउज़र में कार्रवाई कर सकता है। इसमें अन्य Claude उत्पादों से अलग जोखिम हैं। ब्राउज़र में की गई कार्रवाइयों की ज़िम्मेदारी आपकी है।',
    beforeYouStartContinue: 'जारी रखें',
    keyboardShortcut: 'कीबोर्ड शॉर्टकट',
    askBeforeActingDesc: 'Claude कार्रवाई से पहले अपना तरीका तय करता है।',
    actWithoutAskingDesc: 'Claude अनुमति माँगे बिना काम करता है।',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'क्लासिक पर वापस जाएँ',
    openSettings: 'सेटिंग्स खोलें',
    pinDismiss: 'समझ गया',
  },
  'id-ID': {
    beforeYouStart: 'Sebelum memulai',
    beforeYouStartRisk:
      'Claude in Chrome dapat melakukan tindakan di browser atas nama Anda. Ini membawa risiko yang berbeda dari produk Claude lainnya. Anda bertanggung jawab atas tindakan di browser.',
    beforeYouStartContinue: 'Lanjutkan',
    keyboardShortcut: 'Pintasan keyboard',
    askBeforeActingDesc: 'Claude merencanakan pendekatan sebelum bertindak.',
    actWithoutAskingDesc: 'Claude bekerja tanpa berhenti untuk meminta persetujuan.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Kembali ke klasik',
    openSettings: 'Buka pengaturan',
    pinDismiss: 'Mengerti',
  },
};

const LOCALE_EXTRAS: Partial<Record<UiLocale, Pack>> = {
  'zh-CN': { ...CRITICAL_OVERRIDES['zh-CN'], ...ZH_CN_EXTRA },
  'zh-TW': CRITICAL_OVERRIDES['zh-TW'],
  'ja-JP': CRITICAL_OVERRIDES['ja-JP'],
  'ko-KR': CRITICAL_OVERRIDES['ko-KR'],
  'de-DE': CRITICAL_OVERRIDES['de-DE'],
  'fr-FR': CRITICAL_OVERRIDES['fr-FR'],
  'es-ES': CRITICAL_OVERRIDES['es-ES'],
  'es-419': CRITICAL_OVERRIDES['es-419'],
  'pt-BR': CRITICAL_OVERRIDES['pt-BR'],
  'it-IT': CRITICAL_OVERRIDES['it-IT'],
  'ru-RU': CRITICAL_OVERRIDES['ru-RU'],
  'hi-IN': CRITICAL_OVERRIDES['hi-IN'],
  'id-ID': CRITICAL_OVERRIDES['id-ID'],
};

function stripSettingsTag(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  // official: "... in <settingsButton>settings</settingsButton>."
  return raw
    .replace(/<\/?settingsButton>/gi, '')
    .replace(/\.\s*$/, '')
    .replace(/\s+in\s+settings\s*$/i, '')
    .trim();
}

function build(locale: UiLocale): UiStrings {
  const pack: Pack = {
    ...EN_EXTRA,
    ...PACKS['en-US'],
    ...PACKS[locale],
    ...(LOCALE_EXTRAS[locale] ?? {}),
  };

  const p = (key: string, fallback = ''): string => pack[key] ?? fallback;

  const footerBase = stripSettingsTag(
    p('permissionFooterRaw'),
    p('permissionFooter', EN_EXTRA.permissionFooter!),
  );

  const isZh = locale === 'zh-CN' || locale === 'zh-TW';

  return {
    sidepanelTitle: p('sidepanelTitle', 'Claude for Chrome'),
    optionsTitle: p('optionsTitle', 'Claude Options'),
    productName: p('productName', 'Claude for Chrome'),

    clearChat: p('clearChat', 'Clear chat'),
    menu: p('menu', 'Menu'),
    settings: p('settings', 'Settings'),
    keyboardShortcut: p('keyboardShortcut', 'Keyboard shortcut'),
    language: p('language', 'Language'),
    openSettingsEllipsis: p('openSettingsEllipsis', 'Open settings…'),
    chooseModel: p('chooseModel', 'Choose a model'),
    noModelsYet: p('noModelsYet', 'No models loaded yet.'),
    modelSelectorAria: (model) =>
      isZh
        ? model
          ? `模型选择器，已选 ${model}`
          : '模型选择器，尚未选择模型'
        : model
          ? `Model selector, ${model} selected`
          : 'Model selector, no model selected',

    emptyGreeting: p('emptyGreeting', "Hi, I'm Claude. How can I help you today?"),
    emptyNeedSetup: p('emptyNeedSetup', 'Set up your API connection to start'),
    openSettings: p('openSettings', 'Open settings'),
    suggestionSummarize: p('suggestionSummarize', 'Summarize this page'),
    suggestionPricing: p('suggestionPricing', 'Find the pricing on this site'),
    suggestionForm: p('suggestionForm', 'Fill in this form with my details'),

    howCanIHelp: p('howCanIHelp', 'How can I help you today?'),
    typeSlashCommands: p('typeSlashCommands', 'Type / for commands'),
    replyToClaude: p('replyToClaude', 'Reply to Claude'),
    answerPermissionAbove: p('answerPermissionAbove', 'Answer the permission request above'),
    askBeforeActing: p('askBeforeActing', 'Ask before acting'),
    actWithoutAsking: p('actWithoutAsking', 'Act without asking'),
    askBeforeActingDesc: p(
      'askBeforeActingDesc',
      'Claude plans its approach before taking actions.',
    ),
    actWithoutAskingDesc: p(
      'actWithoutAskingDesc',
      'Claude works without pausing for approval.',
    ),
    attachFiles: p('attachFiles', 'Attach files'),
    sendMessage: p('sendMessage', 'Send message'),
    stopMessage: p('stopMessage', 'Stop message'),
    permissionModeAria: (label) =>
      isZh ? `权限模式：${label}` : `Permission mode: ${label}`,

    working: p('working', 'Working'),
    waitingForPermission: p('waitingForPermission', 'Waiting for permission request...'),
    stepsOne: isZh ? '1 步' : '1 step',
    stepsMany: (n) => (isZh ? `${n} 步` : `${n} steps`),

    newPermissionsRequired: p('newPermissionsRequired', 'New permissions required'),
    permission: p('permission', 'Permission'),
    claudeWantsTo: (verb) =>
      isZh ? `Claude 想要${verb}：` : `Claude wants to ${verb}:`,
    claudeWantsApproval: p('claudeWantsApproval', 'Claude wants your approval to:'),
    allowOnce: p('allowOnce', 'Allow once'),
    decline: p('decline', 'Decline'),
    approvePlan: p('approvePlan', 'Approve plan'),
    makeChanges: p('makeChanges', 'Make changes'),
    alwaysAllowSite: p('alwaysAllowSite', 'Always allow actions on this site'),
    browseClickType: p('browseClickType', 'Browse, click, and type'),
    sitePermissionsDisabled: p(
      'sitePermissionsDisabled',
      'Site-level permissions are disabled for this site.',
    ),
    permissionFooter: footerBase,
    settingsLink: p('settingsLink', p('settings', 'settings')),
    allowedOnce: p('allowedOnce', 'Allowed once.'),
    allowedRemembered: p('allowedRemembered', 'Allowed — and remembered for this site.'),
    declined: p('declined', 'Declined.'),

    verbRead: p('verbRead', 'read this page'),
    verbClick: p('verbClick', 'click'),
    verbType: p('verbType', 'type'),
    verbNavigate: p('verbNavigate', 'navigate'),
    verbJs: p('verbJs', 'run JavaScript'),
    verbUpload: p('verbUpload', 'upload a file'),
    verbConsole: p('verbConsole', 'read the console'),
    verbNetwork: p('verbNetwork', 'inspect network traffic'),
    verbPlan: p('verbPlan', 'follow a plan'),
    verbAct: p('verbAct', 'act'),

    skipAllTitle: p('skipAllTitle', 'Skip all permissions across the internet?'),
    warning: p('warning', 'WARNING'),
    skipRisk1: p('skipRisk1', EN_EXTRA.skipRisk1!),
    skipRisk2: p('skipRisk2', EN_EXTRA.skipRisk2!),
    skipRisk3: p('skipRisk3', EN_EXTRA.skipRisk3 ?? ''),
    skipRisk4Before: p('skipRisk4Before', 'Review'),
    skipRisk4Link: p('skipRisk4Link', 'risks'),
    skipRisk4After: p('skipRisk4After', 'before you begin.'),
    cancel: p('cancel', 'Cancel'),
    skipPermissions: p('skipPermissions', 'Skip permissions'),

    hideSteps: p('hideSteps', 'Hide steps'),
    stepOne: p('stepOne', isZh ? '1 步' : '1 step'),
    stepsCount: (n) => (isZh ? `${n} 步` : `${n} steps`),

    optionsHeading: p('optionsHeading', 'Claude in Chrome settings'),
    optionsIntro: p('optionsIntro', EN_EXTRA.optionsIntro!),
    sectionApi: p('sectionApi', 'API connection'),
    sectionApiNote: p('sectionApiNote', EN_EXTRA.sectionApiNote!),
    sectionWhere: p('sectionWhere', 'Where the agent may act'),
    sectionWhereNote: p('sectionWhereNote', EN_EXTRA.sectionWhereNote!),
    sectionCapabilities: p('sectionCapabilities', 'Capabilities'),
    sectionAppearance: p('sectionAppearance', 'Appearance'),
    sectionPermissions: p('sectionPermissions', 'Your approved sites'),
    sectionPermissionsNote: p('sectionPermissionsNote', EN_EXTRA.sectionPermissionsNote!),
    sectionShortcuts: p('shortcuts', p('sectionShortcuts', 'Shortcuts')),
    sectionShortcutsNote: p('sectionShortcutsNote', EN_EXTRA.sectionShortcutsNote!),
    sectionSchedules: p('scheduled', p('sectionSchedules', 'Scheduled')),
    sectionSchedulesNote: p('sectionSchedulesNote', EN_EXTRA.sectionSchedulesNote!),
    languageHint: p('languageHint', EN_EXTRA.languageHint ?? ''),
    theme: p('theme', 'Theme'),
    saveChanges: p('saveChanges', 'Save changes'),
    discard: p('discard', 'Discard'),
    saved: p('settingsSaved', p('saved', 'Saved.')),
    unsaved: p('unsaved', 'Unsaved changes'),

    pinTitle: p('pinTitle', 'Pin Claude for quick access'),
    pinSubtitle: p(
      'pinSubtitle',
      'Click the pin icon in the top right corner of the extension window',
    ),
    pinDismiss: p('pinDismiss', p('beforeYouStartContinue', 'Got it')),
    beforeYouStart: p('beforeYouStart', 'Before you start'),
    beforeYouStartRisk: p('beforeYouStartRisk', EN_EXTRA.beforeYouStartRisk!),
    beforeYouStartContinue: p('beforeYouStartContinue', 'Continue'),
    tabGroupAccess: p('tabGroupAccess', 'Claude has tab group access'),
    tabGroupAccessBody: p('tabGroupAccessBody', EN_EXTRA.tabGroupAccessBody!),
    automateRepetitive: p('automateRepetitive', 'Automate your repetitive tasks'),
    claudeCowork: p('claudeCowork', 'Claude Cowork'),
    switchBackClassic: p('switchBackClassic', 'Switch back to classic'),
    coworkUnavailableTitle: p('coworkUnavailableTitle', 'Claude Cowork'),
    coworkUnavailableBody: p('coworkUnavailableBody', EN_EXTRA.coworkUnavailableBody!),
    coworkOpenClaudeAi: p('coworkOpenClaudeAi', 'Open claude.ai'),
    pairingTitle: p('pairingTitle', EN_EXTRA.pairingTitle!),
    pairingBody: p('pairingBody', EN_EXTRA.pairingBody!),
    pairingGotIt: p('pairingGotIt', 'Got it'),

    teachClaude: p('teachClaude', 'Teach Claude'),
    teachYourWorkflow: p('teachYourWorkflow', 'Teach Claude your workflow'),
    teachIntroBody: p('teachIntroBody', EN_EXTRA.teachIntroBody!),
    teachStartRecording: p('teachStartRecording', 'Start recording'),
    teachRecording: p('teachRecording', 'Recording'),
    teachPaused: p('teachPaused', 'Paused'),
    teachPause: p('teachPause', 'Pause'),
    teachResume: p('teachResume', 'Resume'),
    teachStop: p('teachStop', 'Stop'),
    teachVoice: p('teachVoice', 'Voice'),
    teachVoiceOn: p('teachVoiceOn', 'Listening…'),
    teachClickHint: p('teachClickHint', 'Click elements on the page to record steps.'),
    teachStep: p('teachStep', 'step'),
    teachSteps: p('teachSteps', 'steps'),
    teachSaveTitle: p('teachSaveTitle', 'Save workflow'),
    teachNameLabel: p('teachNameLabel', 'Name'),
    teachSaveAndRun: p('teachSaveAndRun', 'Save & run'),
    teachSaveOnly: p('teachSaveOnly', 'Save only'),
    teachDefaultTitle: p('teachDefaultTitle', 'Recorded workflow'),
    teachNeedPage: p('teachNeedPage', EN_EXTRA.teachNeedPage!),
    teachNoSteps: p('teachNoSteps', 'Record at least one step before saving.'),
    teachSpeechUnsupported: p(
      'teachSpeechUnsupported',
      'Speech recognition is not available in this browser.',
    ),
    teachShortcutDesc: (n) =>
      isZh
        ? `通过演示录制的工作流（${n} 步）`
        : `Workflow taught by demonstration (${n} step${n === 1 ? '' : 's'})`,
    teachSlashDesc: p(
      'teachSlashDesc',
      'Demonstrate a workflow by clicking on the page, then save it as a shortcut.',
    ),
    suggestionTeach: p('suggestionTeach', 'Teach Claude a workflow'),
    teachExportGif: (n) =>
      isZh ? `导出 GIF（${n} 帧）` : `Export GIF (${n} frame${n === 1 ? '' : 's'})`,
    teachExporting: p('teachExporting', 'Exporting…'),
    teachGifSaved: (n) =>
      isZh ? `GIF 已保存（${n} 帧）` : `GIF saved (${n} frame${n === 1 ? '' : 's'})`,
    teachNoFrames: p(
      'teachNoFrames',
      'No frames captured. Enable frame capture in Options to export a GIF.',
    ),
    sectionTeach: p('sectionTeach', 'Teach Claude'),
    sectionTeachNote: p(
      'sectionTeachNote',
      'Recording options for the Teach Claude / Record workflow feature.',
    ),
    teachSpeechEnable: p(
      'teachSpeechEnable',
      'Start voice transcription automatically when recording',
    ),
    teachSpeechEnableHint: p(
      'teachSpeechEnableHint',
      'You can still toggle the microphone on the recording bar.',
    ),
    teachSpeechLangLabel: p('teachSpeechLangLabel', 'Speech recognition language'),
    teachSpeechLangHint: p(
      'teachSpeechLangHint',
      'BCP-47 tag (e.g. en-US, zh-CN). Leave empty to follow the interface language.',
    ),
    teachCaptureFramesLabel: p(
      'teachCaptureFramesLabel',
      'Capture page frames during recording (for GIF export)',
    ),
    teachCaptureFramesHint: p(
      'teachCaptureFramesHint',
      'Takes a screenshot per step so you can export the session as an animated GIF.',
    ),
  };
}

const CACHE = new Map<UiLocale, UiStrings>();

export function normalizeUiLocale(locale: string | undefined | null): UiLocale {
  if (!locale) return 'en-US';
  if ((PACKS as Record<string, Pack>)[locale]) return locale as UiLocale;
  // loose aliases
  const lower = locale.toLowerCase().replace('_', '-');
  if (lower.startsWith('zh-tw') || lower === 'zh-hant') return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('ja')) return 'ja-JP';
  if (lower.startsWith('ko')) return 'ko-KR';
  if (lower.startsWith('de')) return 'de-DE';
  if (lower.startsWith('fr')) return 'fr-FR';
  if (lower === 'es-419' || lower.startsWith('es-mx') || lower.startsWith('es-ar')) return 'es-419';
  if (lower.startsWith('es')) return 'es-ES';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('it')) return 'it-IT';
  if (lower.startsWith('ru')) return 'ru-RU';
  if (lower.startsWith('hi')) return 'hi-IN';
  if (lower.startsWith('id')) return 'id-ID';
  return 'en-US';
}

export function getUiStrings(locale: UiLocale | string | undefined): UiStrings {
  const id = normalizeUiLocale(locale);
  let s = CACHE.get(id);
  if (!s) {
    s = build(id);
    CACHE.set(id, s);
  }
  return s;
}

/** @deprecated use UI_LOCALES labels */
export const english = 'English';
export const chineseSimplified = '简体中文';

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
import { CHROME_PARITY } from './chromeParityStrings';

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

/** Official overflow language order (Claude in Chrome 1.0.81 + zh/ru). */
export const UI_LOCALES: Array<{ id: UiLocale; label: string }> = [
  { id: 'en-US', label: 'English' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'ko-KR', label: '한국어' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'es-419', label: 'Español (Latinoamérica)' },
  { id: 'es-ES', label: 'Español (España)' },
  { id: 'it-IT', label: 'Italiano' },
  { id: 'hi-IN', label: 'हिन्दी' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'id-ID', label: 'Bahasa Indonesia' },
  { id: 'ru-RU', label: 'Русский' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
];

export type UiStrings = {
  sidepanelTitle: string;
  optionsTitle: string;
  productName: string;
  /** Footer under composer — official Hz3uf5n9Ga */
  aiDisclaimer: string;

  clearChat: string;
  menu: string;
  settings: string;
  /** Official Z7sL1cCQpI */
  convertToTask: string;
  convertingToTask: string;
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
  /** Official composer + menu (wL7VAE/fRX) */
  actions: string;
  takeScreenshot: string;
  addAnImage: string;
  screenshotUnavailable: string;
  sendMessage: string;
  stopMessage: string;
  permissionModeAria: (label: string) => string;

  working: string;
  waitingForPermission: string;
  stepsOne: string;
  stepsMany: (n: number) => string;
  /** Official Done row under expanded timeline (JXdbo8Vnlw). */
  done: string;

  /**
   * Official W() tool-row labels (sidepanel-CEYFzMrx.js KC/W).
   * Stream rows must use these — not freehand English.
   */
  toolTakeScreenshot: string;
  toolClick: string;
  toolRightClick: string;
  toolDoubleClick: string;
  toolTripleClick: string;
  toolDrag: string;
  toolTypeText: string;
  toolTypeWith: (text: string) => string;
  toolPressKey: string;
  toolPressKeyWith: (key: string) => string;
  toolScroll: string;
  toolScrollDir: (dir: string) => string;
  toolWaitSeconds: (n: number) => string;
  toolReadPage: string;
  toolReadPageInteractive: string;
  toolReadPageAll: string;
  toolFindElement: string;
  toolFindQuery: (q: string) => string;
  toolExtractPageText: string;
  toolNavigateTo: (url: string) => string;
  toolSetFormValue: string;
  toolCreateNewTab: string;
  toolGetTabs: string;
  toolCloseTab: string;
  toolGetMcpTabs: string;
  toolCreateMcpTab: string;
  toolCloseMcpTab: string;
  toolResizeWindow: string;
  toolExecuteJavaScript: string;
  toolUploadImage: string;
  toolStepOf: (current: number, total: number) => string;
  /** Official FZ language change confirm (yPUC8ZWYmE) */
  languageChangeConfirm: string;
  languageChangeConfirmTitle: string;
  confirm: string;

  newPermissionsRequired: string;
  permission: string;
  claudeWantsTo: (verb: string) => string;
  claudeWantsApproval: string;
  allowOnce: string;
  /** Official CZ primary button: "Allow this action" (not "Allow once"). */
  allowThisAction: string;
  decline: string;
  approvePlan: string;
  makeChanges: string;
  alwaysAllowSite: string;
  browseClickType: string;
  sitePermissionsDisabled: string;
  /** Official eS plan card title: "Claude’s plan" */
  claudePlanTitle: string;
  /** Official eS: "Allow actions on these sites" */
  planAllowSites: string;
  /** Official eS: "Approach to follow" */
  planApproach: string;
  /** Official eS footer (no settings link). */
  planFooter: string;
  /** Compact answered plan chip. */
  planApproved: string;
  planRejected: string;
  /**
   * Official gM stream row for update_plan
   * (P0iWYFMJG2 / aXfQ2L8ErF / 7wJz7kSrLT / hW8KjZhriV).
   */
  creatingPlan: string;
  createdPlan: string;
  planRejectedRow: string;
  planLabel: string;
  /**
   * Official YC browser_batch header (q1/79Ks14U) + error secondary (Q7Tmii1wrQ).
   */
  batchActions: (completed: number, total: number) => string;
  batchStoppedOnError: string;
  /** Official TYPE permission body label: "Text to be typed:" */
  textToBeTyped: string;
  /** Official jZ domain transition card */
  domainTransitionPaused: (fromDomain: string, toDomain: string) => string;
  domainTransitionContinue: string;
  domainTransitionStop: string;
  domainTransitionAlways: string;
  domainTransitionAlwaysHint: string;
  /** Options: remembered from→to pairs */
  sectionDomainTransitions: string;
  sectionDomainTransitionsNote: string;
  convertToTaskFailed: string;
  /**
   * Official permission footer is one ICU string with an inline
   * `<settingsButton>…</settingsButton>`. We split it into:
   *   permissionFooter + settingsLink button + permissionFooterAfter
   * so Chinese mid-string 「设置」does not become "…设置… 设置.".
   */
  permissionFooter: string;
  settingsLink: string;
  /** Text after the settings link (e.g. "中撤销网站权限。" / "."). */
  permissionFooterAfter: string;
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
  /** Official options: open side panel shortcut → chrome://extensions/shortcuts */
  sectionKeyboard: string;
  sectionKeyboardNote: string;
  openKeyboardShortcuts: string;
  /** Official options: task completion notifications */
  sectionNotifications: string;
  sectionNotificationsNote: string;
  notificationsEnabledLabel: string;
  notificationsEnabledHint: string;
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
  /** Official IZ primary CTA */
  tabGroupOnboardingNext: string;
  /** Official RZ secondary-tab screen */
  tabGroupActiveTitle: string;
  tabGroupActiveBody: string;
  tabGroupOpenChat: string;
  /** Official BM notification banner */
  notifyBannerBody: string;
  notifyMe: string;
  dismissBanner: string;
  /** OS notification when turn completes (enabled prefs) */
  notifyDoneTitle: string;
  notifyDoneBody: string;
  automateRepetitive: string;
  claudeCowork: string;
  switchBackClassic: string;
  coworkUnavailableTitle: string;
  coworkUnavailableBody: string;
  coworkOpenClaudeAi: string;
  pairingTitle: string;
  pairingBody: string;
  pairingGotIt: string;
  /** Official PairingPrompt (Desktop / Claude Code connect) */
  pairingWantsToConnect: (client: string) => string;
  pairingNameBrowser: string;
  pairingNamePlaceholder: string;
  pairingIgnore: string;
  pairingConnect: string;

  /** Markdown code fence chrome (official aCdAsIsVv0 copy button). */
  copyToClipboard: string;
  codeCopied: string;
  codeBlockLabel: string;
  mermaidRendering: string;
  mermaidError: string;
  mermaidEmpty: string;

  /** Official 8Rj4WgXPcB / 4l6vz1/eZ5 / p556q3uvbn */
  copyMessage: string;
  copy: string;
  copied: string;

  /** Options schedule form (official SchedulingFields) */
  scheduleOnce: string;
  scheduleDaily: string;
  scheduleWeekly: string;
  scheduleMonthly: string;
  scheduleAnnually: string;
  scheduleStartFrom: string;
  scheduleTimePlaceholder: string;
  scheduleInvalidTime: string;
  createScheduledTask: string;
  schedulePause: string;
  scheduleResume: string;
  noSchedulesYet: string;
  scheduleTitlePlaceholder: string;
  schedulePromptPlaceholder: string;
  scheduleEveryMinutesFallback: (n: number) => string;
  scheduleDaySun: string;
  scheduleDayMon: string;
  scheduleDayTue: string;
  scheduleDayWed: string;
  scheduleDayThu: string;
  scheduleDayFri: string;
  scheduleDaySat: string;
  scheduleDatePlaceholder: string;
  scheduleDayOfMonth: string;
  scheduleMonthDay: string;
  scheduleFrequency: string;
  scheduleTime: string;

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
  teachSaveAsShortcut: string;
  /** Official ZpE0fwR7on */
  teachSaveAsTeachClaude: string;
  teachGenerating: string;
  teachEnableMic: string;
  teachIntroBodyMic: string;
  teachSkipMic: string;
  teachMicDenied: string;
  teachMicAllowHint: string;
  teachMicBanner: string;
  teachDiscard: string;
  teachDone: string;
  teachDefaultTitle: string;
  teachNeedPage: string;
  teachNoSteps: string;
  teachSpeechUnsupported: string;
  teachGrantMic: string;
  teachGrantMicHint: string;
  teachMicStatusGranted: string;
  teachMicStatusDenied: string;
  teachMicStatusPrompt: string;
  teachShortcutDesc: (n: number) => string;
  teachSlashDesc: string;
  suggestionTeach: string;
  teachExportGif: (n: number) => string;
  teachExporting: string;
  teachGifSaved: (n: number) => string;
  teachNoFrames: string;
  teachLoading: string;
  /** Options — Teach Claude / speech section */
  sectionTeach: string;
  sectionTeachNote: string;
  teachSpeechEnable: string;
  teachSpeechEnableHint: string;
  teachSpeechLangLabel: string;
  teachSpeechLangHint: string;
  teachCaptureFramesLabel: string;
  teachCaptureFramesHint: string;

  /** Options — open MCP (Desktop / Claude Code native host) */
  sectionMcp: string;
  sectionMcpNote: string;
  mcpHostInstalled: string;
  mcpHostMissing: string;
  mcpSessionConnected: string;
  mcpSessionIdle: string;
  mcpRefresh: string;
  mcpReconnect: string;
  mcpHostLabel: (label: string) => string;
  /** Extra guidance under MCP status (permissions + yellow group). */
  mcpPermissionHint: string;
  mcpGroupHint: string;
};

/** Keys not present (or incomplete) in official non-EN packs — English base. */
const EN_EXTRA: Pack = {
  // Official chrome extension name is "Claude" (manifest + sidepanel title)
  sidepanelTitle: 'Claude',
  optionsTitle: 'Claude Options',
  productName: 'Claude',
  aiDisclaimer: 'Claude is AI and can make mistakes. Please double-check responses.',
  convertToTask: 'Convert to task',
  convertingToTask: 'Converting…',
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
  actions: 'Actions',
  takeScreenshot: 'Take a screenshot',
  addAnImage: 'Add an image',
  screenshotUnavailable: 'Screenshot is not available on this page',
  sendMessage: 'Send message',
  stopMessage: 'Stop message',
  permission: 'Permission',
  claudeWantsApproval: 'Claude wants your approval to:',
  sitePermissionsDisabled: 'Site-level permissions are disabled for this site.',
  claudePlanTitle: 'Claude’s plan',
  planAllowSites: 'Allow actions on these sites',
  planApproach: 'Approach to follow',
  planFooter:
    "Claude will only use the sites listed. You'll be asked before accessing anything else.",
  planApproved: 'Plan approved',
  planRejected: 'Rejected',
  creatingPlan: 'Creating plan...',
  createdPlan: 'Created a plan',
  planRejectedRow: 'Plan rejected',
  planLabel: 'Plan',
  batchStoppedOnError: 'Stopped on error',
  textToBeTyped: 'Text to be typed:',
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
    'Point this at your own relay root. Do not include /v1 — requests use {base}/v1/messages.',
  sectionWhere: 'Where the agent may act',
  sectionWhereNote: 'Leave the allow-list empty to permit any site. The block-list always wins.',
  sectionCapabilities: 'Capabilities',
  sectionAppearance: 'Appearance',
  sectionKeyboard: 'Keyboard shortcut',
  sectionKeyboardNote:
    'Set the key combination that opens the side panel in Chrome’s extension shortcuts page.',
  openKeyboardShortcuts: 'Open shortcut settings',
  sectionNotifications: 'Notifications',
  sectionNotificationsNote:
    'Whether to show a system notification when a task finishes or needs your input.',
  notificationsEnabledLabel: 'Notify me when tasks complete',
  notificationsEnabledHint:
    'When off, the side-panel notification banner will not reappear.',
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
    'If Claude is open in a tab group, it can access the URL, context and information of all the tabs in that group.',
  tabGroupOnboardingNext: 'Next',
  tabGroupActiveTitle: 'Claude is active in this tab group',
  tabGroupActiveBody:
    'Claude can research across sites, compare information, or handle multi-tab tasks.',
  tabGroupOpenChat: 'Open chat',
  notifyBannerBody: 'Get notified when tasks complete or need input',
  notifyMe: 'Notify me',
  dismissBanner: 'Dismiss',
  notifyDoneTitle: 'Claude is done',
  notifyDoneBody: 'Your task is completed. Ready to check in?',
  coworkUnavailableTitle: 'Claude Cowork',
  coworkUnavailableBody:
    'The official Cowork side panel embeds claude.ai account chat. This build runs the classic browser agent against your own API key — no Anthropic login required.',
  coworkOpenClaudeAi: 'Open claude.ai',
  pairingTitle: 'Browser already connected',
  pairingBody:
    'Official pairing links Claude Desktop / Claude Code to this extension over native messaging (open MCP). Tools run in a yellow “Claude (MCP)” tab group. Side-panel chat still uses your own API key in Settings — no pairing code is required for that path.',
  pairingGotIt: 'Got it',
  pairingNameBrowser: 'Name this browser so you can identify it later.',
  pairingNamePlaceholder: 'e.g., “Work laptop”, “Personal Chrome”',
  pairingIgnore: 'Ignore',
  pairingConnect: 'Connect',
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
    'Go through the steps as if you’re teaching a new teammate. Claude will learn the process and repeat it for you.',
  teachIntroBodyMic:
    'Enable your microphone to narrate as you demonstrate the workflow. Claude will learn the process and repeat it for you.',
  teachStartRecording: 'Start recording',
  teachEnableMic: 'Enable microphone',
  teachSkipMic: 'Start without microphone',
  teachMicDenied:
    'Microphone access was denied. You can still record clicks without voice, or allow the mic in Options.',
  teachMicAllowHint:
    'Choose “Allow while visiting the site” so voice narration stays on for Teach Claude.',
  teachMicBanner:
    'Enable microphone for voice narration. Recording without speech.',
  teachGrantMic: 'Allow microphone',
  teachGrantMicHint:
    'Used for optional voice narration while teaching a workflow. Clicks still record without it.',
  teachMicStatusGranted: 'Microphone allowed',
  teachMicStatusDenied: 'Microphone blocked — allow it in the site controls or try again',
  teachMicStatusPrompt: 'Microphone not enabled yet',
  teachRecording: 'Recording',
  teachPaused: 'Paused',
  teachPause: 'Pause',
  teachResume: 'Resume',
  teachStop: 'Stop',
  teachDiscard: 'Discard',
  teachDone: 'Done',
  teachVoice: 'Voice',
  teachVoiceOn: 'Listening…',
  teachClickHint: 'Click through your task to record each step',
  teachStep: 'step',
  teachSteps: 'steps',
  teachSaveTitle: 'Save workflow',
  teachNameLabel: 'Name',
  teachSaveAndRun: 'Save & run',
  teachSaveOnly: 'Save only',
  teachSaveAsShortcut: 'Save as shortcut',
  teachGenerating: 'Generating…',
  teachLoading: 'Loading…',
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
  // Options — open MCP
  sectionMcp: 'Desktop & Claude Code (MCP)',
  sectionMcpNote:
    'When Claude Desktop or Claude Code is installed with the browser extension host, they can drive this extension over native messaging (open MCP). Tools run in a yellow “Claude (MCP)” tab group (separate from the orange side-panel “Claude” group). Cloud pairing via claude.ai is not used — only the native host bridge.',
  mcpHostInstalled: 'Native host connected',
  mcpHostMissing:
    'No native host found. Install Claude Desktop or Claude Code, then click Reconnect. (openclaude-local is an API companion only and does not provide the tool bridge.)',
  mcpSessionConnected: 'MCP session active',
  mcpSessionIdle: 'Host present — waiting for an MCP session from Desktop / Claude Code',
  mcpRefresh: 'Refresh status',
  mcpReconnect: 'Reconnect',
  mcpPermissionHint:
    'When Desktop / Claude Code needs a grant, a focused 600×600 permission popup opens (official mcpPermissionOnly). MCP ignores chat Always / “Act without asking”; each action is once + retry. Nested browser_batch steps only run if already allowed — first-time grants must be standalone.',
  mcpGroupHint:
    'While a session is active, tabs leaving the yellow MCP group are detached from the debugger automatically (official hygiene).',
  // Markdown chrome (official aCdAsIsVv0)
  copyToClipboard: 'Copy to clipboard',
  codeCopied: 'Copied',
  codeBlockLabel: 'code',
  mermaidRendering: 'Rendering diagram…',
  mermaidError: 'Diagram error',
  mermaidEmpty: 'Empty mermaid diagram',
  copyMessage: 'Copy message',
  copy: 'Copy',
  copied: 'Copied',
  scheduleOnce: 'Once',
  scheduleDaily: 'Daily',
  scheduleWeekly: 'Weekly',
  scheduleMonthly: 'Monthly',
  scheduleAnnually: 'Annually',
  scheduleStartFrom: 'Start from',
  scheduleTimePlaceholder: 'e.g., 9:30 AM or 14:00',
  scheduleInvalidTime: 'Invalid time format',
  createScheduledTask: 'Create scheduled task',
  schedulePause: 'Pause',
  scheduleResume: 'Resume',
  noSchedulesYet: 'No schedules yet.',
  scheduleTitlePlaceholder: 'Title',
  schedulePromptPlaceholder: 'Prompt to run when the task fires',
  scheduleDatePlaceholder: 'YYYY-MM-DD',
  scheduleDayOfMonth: 'Day of month (1–31)',
  scheduleMonthDay: 'MM-DD',
  scheduleFrequency: 'Frequency',
  scheduleTime: 'Time (HH:mm)',
  teachSaveAsTeachClaude: 'Save as Teach Claude',
};

const ZH_CN_EXTRA: Pack = {
  sidepanelTitle: 'Claude',
  productName: 'Claude',
  optionsTitle: 'Claude 选项',
  aiDisclaimer: 'Claude 是 AI，可能会犯错。请仔细检查回答。',
  convertToTask: '转换为任务',
  convertingToTask: '正在转换…',
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
  actions: '操作',
  copyToClipboard: '复制到剪贴板',
  codeCopied: '已复制',
  codeBlockLabel: '代码',
  mermaidRendering: '正在渲染图表…',
  mermaidError: '图表错误',
  mermaidEmpty: '空的 mermaid 图表',
  copyMessage: '复制消息',
  copy: '复制',
  copied: '已复制',
  scheduleOnce: '一次',
  scheduleDaily: '每天',
  scheduleWeekly: '每周',
  scheduleMonthly: '每月',
  scheduleAnnually: '每年',
  scheduleStartFrom: '开始于',
  scheduleTimePlaceholder: '例如：9:30 AM 或 14:00',
  scheduleInvalidTime: '无效的时间格式',
  createScheduledTask: '创建计划任务',
  schedulePause: '暂停',
  scheduleResume: '继续',
  noSchedulesYet: '暂无计划任务。',
  scheduleTitlePlaceholder: '标题',
  schedulePromptPlaceholder: '任务触发时运行的提示词',
  scheduleDatePlaceholder: 'YYYY-MM-DD',
  scheduleDayOfMonth: '每月第几天（1–31）',
  scheduleMonthDay: 'MM-DD',
  scheduleFrequency: '频率',
  scheduleTime: '时间（HH:mm）',
  teachSaveAsTeachClaude: '保存为“教 Claude”',
  takeScreenshot: '截取屏幕',
  addAnImage: '添加图片',
  screenshotUnavailable: '此页面无法使用屏幕截图',
  sendMessage: '发送消息',
  stopMessage: '停止',
  permission: '权限',
  claudeWantsApproval: 'Claude 需要您批准：',
  sitePermissionsDisabled: '此网站已禁用站点级权限。',
  claudePlanTitle: 'Claude’s plan',
  planAllowSites: '允许在这些网站上执行操作',
  planApproach: '遵循的方法',
  planFooter: 'Claude 将仅使用列出的网站。访问其他内容前会询问您。',
  planApproved: '计划已批准',
  planRejected: '已拒绝',
  // Official zh-CN pack (P0iWYFMJG2 / aXfQ2L8ErF / 7wJz7kSrLT / hW8KjZhriV)
  creatingPlan: '正在创建计划...',
  createdPlan: '创建了计划',
  planRejectedRow: '计划被拒绝',
  planLabel: '计划',
  batchStoppedOnError: '因错误停止',
  textToBeTyped: '要输入的文本：',
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
  sectionApiNote: '指向您自己的中转根地址。不要带 /v1 — 请求会发到 {base}/v1/messages。',
  sectionWhere: '可操作的范围',
  sectionWhereNote: '允许列表留空表示不限制站点。阻止列表始终优先。',
  sectionCapabilities: '功能',
  sectionAppearance: '外观',
  sectionKeyboard: '键盘快捷键',
  sectionKeyboardNote: '在 Chrome 扩展快捷键页配置打开侧栏的组合键。',
  openKeyboardShortcuts: '打开快捷键设置',
  sectionNotifications: '通知',
  sectionNotificationsNote: '任务完成或需要你确认时，是否弹出系统通知。',
  notificationsEnabledLabel: '任务完成时通知我',
  notificationsEnabledHint: '关闭后不再显示侧栏顶部的通知提示条。',
  sectionPermissionsNote: '您选择“始终允许”的网站。撤销立即生效。',
  sectionShortcutsNote: '在聊天中输入 / 使用快捷指令，或按计划运行。首次打开会创建示例。',
  sectionSchedulesNote: '仅在侧栏打开时运行。若关闭，会收到通知 — 这不是无人值守自动化。',
  theme: '主题',
  discard: '放弃',
  unsaved: '有未保存的更改',
  pinDismiss: '知道了',
  beforeYouStartContinue: '继续',
  tabGroupAccessBody:
    '如果 Claude 在标签组中打开，它可以访问该组中所有标签页的 URL、上下文和信息。',
  tabGroupOnboardingNext: '下一步',
  tabGroupActiveTitle: 'Claude 在此标签组中处于活动状态',
  tabGroupActiveBody: 'Claude 可以跨站点研究、比较信息或处理多标签页任务。',
  tabGroupOpenChat: '打开聊天',
  notifyBannerBody: '当任务完成或需要输入时获得通知',
  notifyMe: '通知我',
  dismissBanner: '忽略',
  notifyDoneTitle: 'Claude 已完成',
  notifyDoneBody: '您的任务已完成。准备好检查了吗？',
  coworkUnavailableTitle: 'Claude Cowork',
  coworkUnavailableBody:
    '官方 Cowork 侧栏会嵌入 claude.ai 账号聊天。本构建使用经典浏览器智能体 + 您自己的 API Key，无需 Anthropic 登录。',
  coworkOpenClaudeAi: '打开 claude.ai',
  pairingTitle: '浏览器已连接',
  pairingBody:
    '官方配对通过原生消息（open MCP）把 Claude Desktop / Claude Code 连到本扩展，工具在黄色「Claude (MCP)」标签组中执行。侧栏对话仍使用设置里的自有 API Key，无需配对码。',
  pairingGotIt: '知道了',
  pairingNameBrowser: '为这台浏览器命名，方便之后识别。',
  pairingNamePlaceholder: '例如：“公司电脑”、“个人 Chrome”',
  pairingIgnore: '忽略',
  pairingConnect: '连接',
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
  teachIntroBody: '像教新同事一样走完步骤。Claude 会学习这个流程并替你重复。',
  teachIntroBodyMic: '开启麦克风，边演示边口述。Claude 会学习这个流程并替你重复。',
  teachStartRecording: '开始录制',
  teachEnableMic: '启用麦克风',
  teachSkipMic: '不使用麦克风，直接开始',
  teachMicDenied:
    '麦克风权限被拒绝。你仍可无语音录制点击，或在设置页允许麦克风。',
  teachMicAllowHint:
    '请选择「在访问该网站时允许」，以便 Teach Claude 能持续使用语音旁白。',
  teachMicBanner: '启用麦克风以进行语音旁白。当前正在无语音录制。',
  teachGrantMic: '允许麦克风',
  teachGrantMicHint: '用于录制流程时的可选语音旁白。不授权也能录制点击。',
  teachMicStatusGranted: '已允许麦克风',
  teachMicStatusDenied: '麦克风被拦截 — 请在站点控件中允许或重试',
  teachMicStatusPrompt: '尚未启用麦克风',
  teachRecording: '录制中',
  teachPaused: '已暂停',
  teachPause: '暂停',
  teachResume: '继续',
  teachStop: '停止',
  teachDiscard: '丢弃',
  teachDone: '完成',
  teachVoice: '语音',
  teachVoiceOn: '聆听中…',
  teachClickHint: '在页面上逐步点击，以记录每一步',
  teachStep: '步',
  teachSteps: '步',
  teachSaveTitle: '保存工作流',
  teachNameLabel: '名称',
  teachSaveAndRun: '保存并运行',
  teachSaveOnly: '仅保存',
  teachSaveAsShortcut: '保存为快捷指令',
  teachGenerating: '生成中…',
  teachLoading: '加载中…',
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
  sectionMcp: 'Desktop 与 Claude Code（MCP）',
  sectionMcpNote:
    '安装带浏览器扩展宿主的 Claude Desktop 或 Claude Code 后，可通过原生消息（open MCP）驱动本扩展。工具在黄色「Claude (MCP)」标签组中执行（与侧栏橙色「Claude」组分开）。不走 claude.ai 云端配对，仅 native host 桥接。',
  mcpHostInstalled: '已连接原生宿主',
  mcpHostMissing:
    '未找到原生宿主。请安装 Claude Desktop 或 Claude Code 后点「重新连接」。（openclaude-local 仅是 API 伴侣，不提供工具桥接。）',
  mcpSessionConnected: 'MCP 会话进行中',
  mcpSessionIdle: '宿主已就绪 — 等待 Desktop / Claude Code 发起 MCP 会话',
  mcpRefresh: '刷新状态',
  mcpReconnect: '重新连接',
  mcpPermissionHint:
    'Desktop / Claude Code 需要授权时会弹出 600×600 独立审批窗（官方 mcpPermissionOnly）。MCP 不吃聊天里的 Always /「不询问直接操作」；每次动作为单次授权后重试。嵌套 browser_batch 仅执行已授权步骤 — 首次授权请单独调用。',
  mcpGroupHint:
    '会话进行中时，标签页离开黄色 MCP 组会自动断开调试器（与官方卫生策略一致）。',
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
    copyToClipboard: '复制到剪贴板',
    codeCopied: '已复制',
    codeBlockLabel: '代码',
    mermaidRendering: '正在渲染图表…',
    mermaidError: '图表错误',
    mermaidEmpty: '空的 mermaid 图表',
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
    copyToClipboard: '複製到剪貼簿',
    codeCopied: '已複製',
    codeBlockLabel: '程式碼',
    mermaidRendering: '正在渲染圖表…',
    mermaidError: '圖表錯誤',
    mermaidEmpty: '空白的 mermaid 圖表',
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
    copyToClipboard: 'クリップボードにコピー',
    codeCopied: 'コピーしました',
    codeBlockLabel: 'コード',
    mermaidRendering: '図を描画中…',
    mermaidError: '図のエラー',
    mermaidEmpty: '空の mermaid 図',
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
    copyToClipboard: '클립보드에 복사',
    codeCopied: '복사됨',
    codeBlockLabel: '코드',
    mermaidRendering: '다이어그램 렌더링 중…',
    mermaidError: '다이어그램 오류',
    mermaidEmpty: '빈 mermaid 다이어그램',
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
    copyToClipboard: 'In Zwischenablage kopieren',
    codeCopied: 'Kopiert',
    codeBlockLabel: 'Code',
    mermaidRendering: 'Diagramm wird gerendert…',
    mermaidError: 'Diagrammfehler',
    mermaidEmpty: 'Leeres Mermaid-Diagramm',
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
    copyToClipboard: 'Copier dans le presse-papiers',
    codeCopied: 'Copié',
    codeBlockLabel: 'code',
    mermaidRendering: 'Rendu du diagramme…',
    mermaidError: 'Erreur de diagramme',
    mermaidEmpty: 'Diagramme mermaid vide',
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
    copyToClipboard: 'Copiar al portapapeles',
    codeCopied: 'Copiado',
    codeBlockLabel: 'código',
    mermaidRendering: 'Renderizando diagrama…',
    mermaidError: 'Error de diagrama',
    mermaidEmpty: 'Diagrama mermaid vacío',
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
    copyToClipboard: 'Copiar al portapapeles',
    codeCopied: 'Copiado',
    codeBlockLabel: 'código',
    mermaidRendering: 'Renderizando diagrama…',
    mermaidError: 'Error de diagrama',
    mermaidEmpty: 'Diagrama mermaid vacío',
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
    copyToClipboard: 'Copiar para a área de transferência',
    codeCopied: 'Copiado',
    codeBlockLabel: 'código',
    mermaidRendering: 'Renderizando diagrama…',
    mermaidError: 'Erro no diagrama',
    mermaidEmpty: 'Diagrama mermaid vazio',
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
    copyToClipboard: 'Copia negli appunti',
    codeCopied: 'Copiato',
    codeBlockLabel: 'codice',
    mermaidRendering: 'Rendering del diagramma…',
    mermaidError: 'Errore del diagramma',
    mermaidEmpty: 'Diagramma mermaid vuoto',
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
    copyToClipboard: 'Копировать в буфер обмена',
    codeCopied: 'Скопировано',
    codeBlockLabel: 'код',
    mermaidRendering: 'Отрисовка диаграммы…',
    mermaidError: 'Ошибка диаграммы',
    mermaidEmpty: 'Пустая диаграмма mermaid',
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
    copyToClipboard: 'क्लिपबोर्ड पर कॉपी करें',
    codeCopied: 'कॉपी हो गया',
    codeBlockLabel: 'कोड',
    mermaidRendering: 'आरेख रेंडर हो रहा है…',
    mermaidError: 'आरेख त्रुटि',
    mermaidEmpty: 'खाली mermaid आरेख',
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
    copyToClipboard: 'Salin ke clipboard',
    codeCopied: 'Disalin',
    codeBlockLabel: 'kode',
    mermaidRendering: 'Merender diagram…',
    mermaidError: 'Kesalahan diagram',
    mermaidEmpty: 'Diagram mermaid kosong',
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

/**
 * Official: "... in <settingsButton>settings</settingsButton>."
 * Chinese:  "...在<settingsButton>设置</settingsButton>中撤销网站权限。"
 * Split so the link sits where the tag was — never append a second 「设置」.
 */
function parseSettingsFooter(
  raw: string | undefined,
  fallbackBefore: string,
  fallbackLink: string,
): { before: string; link: string; after: string } {
  if (raw) {
    const m = raw.match(
      /^(.*?)<settingsButton>([\s\S]*?)<\/settingsButton>(.*)$/i,
    );
    if (m) {
      // Keep surrounding whitespace exactly as the locale pack wrote it
      // (EN: "... in " + link + "."; ZH: "...在" + link + "中…").
      return {
        before: m[1] ?? '',
        link: (m[2] ?? '').trim() || fallbackLink,
        after: m[3] ?? '',
      };
    }
  }
  // Fallback packs that already dropped the tag (EN_EXTRA style).
  return { before: fallbackBefore, link: fallbackLink, after: '' };
}

function build(locale: UiLocale): UiStrings {
  const pack: Pack = {
    ...EN_EXTRA,
    ...(CHROME_PARITY['en-US'] ?? {}),
    ...PACKS['en-US'],
    ...(CHROME_PARITY[locale] ?? {}),
    ...PACKS[locale],
    ...(LOCALE_EXTRAS[locale] ?? {}),
  };

  const p = (key: string, fallback = ''): string => pack[key] ?? fallback;

  const footerParts = parseSettingsFooter(
    p('permissionFooterRaw'),
    p('permissionFooter', EN_EXTRA.permissionFooter!),
    p('settingsLink', p('settings', 'settings')),
  );

  const isZh = locale === 'zh-CN' || locale === 'zh-TW';

  return {
    sidepanelTitle: p('sidepanelTitle', 'Claude'),
    optionsTitle: p('optionsTitle', 'Claude Options'),
    productName: p('productName', 'Claude'),
    aiDisclaimer: p(
      'aiDisclaimer',
      'Claude is AI and can make mistakes. Please double-check responses.',
    ),

    clearChat: p('clearChat', 'Clear chat'),
    menu: p('menu', 'Menu'),
    settings: p('settings', 'Settings'),
    convertToTask: p('convertToTask', 'Convert to task'),
    convertingToTask: p('convertingToTask', 'Converting…'),
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
    actions: p('actions', 'Actions'),
    takeScreenshot: p('takeScreenshot', 'Take a screenshot'),
    addAnImage: p('addAnImage', 'Add an image'),
    screenshotUnavailable: p(
      'screenshotUnavailable',
      'Screenshot is not available on this page',
    ),
    sendMessage: p('sendMessage', 'Send message'),
    stopMessage: p('stopMessage', 'Stop message'),
    permissionModeAria: (label) =>
      isZh ? `权限模式：${label}` : `Permission mode: ${label}`,

    working: p('working', isZh ? '处理中' : 'Working'),
    waitingForPermission: p(
      'waitingForPermission',
      isZh ? '等待权限请求...' : 'Waiting for permission request...',
    ),
    // Official vAKAnIbJ4M → simplified (no full ICU plural engine)
    stepsOne: isZh ? '1 步' : '1 step',
    stepsMany: (n) => (isZh ? `${n} 步` : `${n} steps`),
    done: p('done', isZh ? '完成' : 'Done'),

    // Official W() tool labels — CHROME_PARITY supplies 14 locales; ZH fallback last.
    toolTakeScreenshot: p('toolTakeScreenshot', isZh ? '截取屏幕' : 'Take screenshot'),
    toolClick: p('toolClick', isZh ? '点击' : 'Click'),
    toolRightClick: p('toolRightClick', isZh ? '右键点击' : 'Right-click'),
    toolDoubleClick: p('toolDoubleClick', isZh ? '双击' : 'Double-click'),
    toolTripleClick: p('toolTripleClick', isZh ? '三击' : 'Triple-click'),
    toolDrag: p('toolDrag', isZh ? '拖动' : 'Drag'),
    toolTypeText: p('toolTypeText', isZh ? '输入文本' : 'Type text'),
    toolTypeWith: (text) => {
      // Prefer current-locale parity only — avoid EN template bleeding via pack merge.
      const localTpl = (CHROME_PARITY[locale] ?? {})['toolTypeWithTpl'];
      const tpl =
        localTpl ||
        (isZh ? '输入：“{text}”' : p('toolTypeWithTpl', 'Type: “{text}”'));
      return tpl.includes('{text}')
        ? tpl.replace('{text}', text)
        : isZh
          ? `输入：“${text}”`
          : `Type: “${text}”`;
    },
    toolPressKey: p('toolPressKey', isZh ? '按键' : 'Press key'),
    toolPressKeyWith: (key) =>
      isZh ? `按键：${key}` : `Press key: ${key}`,
    toolScroll: p('toolScroll', isZh ? '滚动' : 'Scroll'),
    toolScrollDir: (dir) => (isZh ? `滚动 ${dir}` : `Scroll ${dir}`),
    toolWaitSeconds: (n) =>
      isZh
        ? n === 1
          ? '等待 1 秒'
          : `等待 ${n} 秒`
        : n === 1
          ? 'Wait 1 second'
          : `Wait ${n} seconds`,
    toolReadPage: p('toolReadPage', isZh ? '读取页面' : 'Read page'),
    toolReadPageInteractive: p(
      'toolReadPageInteractive',
      isZh ? '读取页面（交互式）' : 'Read page (interactive)',
    ),
    toolReadPageAll: p('toolReadPageAll', isZh ? '读取页面（全部）' : 'Read page (all)'),
    toolFindElement: p('toolFindElement', isZh ? '查找元素' : 'Find element'),
    toolFindQuery: (q) => {
      const localTpl = (CHROME_PARITY[locale] ?? {})['toolFindQueryTpl'];
      const tpl =
        localTpl ||
        (isZh ? '查找：“{query}”' : p('toolFindQueryTpl', 'Find: “{query}”'));
      return tpl.includes('{query}')
        ? tpl.replace('{query}', q)
        : isZh
          ? `查找：“${q}”`
          : `Find: “${q}”`;
    },
    toolExtractPageText: p(
      'toolExtractPageText',
      isZh ? '提取页面文本' : 'Extract page text',
    ),
    toolNavigateTo: (url) => {
      const localTpl = (CHROME_PARITY[locale] ?? {})['toolNavigateToTpl'];
      const tpl =
        localTpl ||
        (isZh ? '导航至 {url}' : p('toolNavigateToTpl', 'Navigate to {url}'));
      return tpl.includes('{url}')
        ? tpl.replace('{url}', url)
        : isZh
          ? `导航至 ${url}`
          : `Navigate to ${url}`;
    },
    toolSetFormValue: p('toolSetFormValue', isZh ? '设置表单值' : 'Set form value'),
    toolCreateNewTab: p('toolCreateNewTab', isZh ? '创建新标签页' : 'Create new tab'),
    toolGetTabs: p('toolGetTabs', isZh ? '获取标签页' : 'Get tabs'),
    toolCloseTab: p('toolCloseTab', isZh ? '关闭标签页' : 'Close tab'),
    toolGetMcpTabs: p('toolGetMcpTabs', isZh ? '获取 MCP 标签页' : 'Get MCP tabs'),
    toolCreateMcpTab: p('toolCreateMcpTab', isZh ? '创建 MCP 标签页' : 'Create MCP tab'),
    toolCloseMcpTab: p('toolCloseMcpTab', isZh ? '关闭 MCP 标签页' : 'Close MCP tab'),
    toolResizeWindow: p('toolResizeWindow', isZh ? '调整窗口大小' : 'Resize window'),
    toolExecuteJavaScript: p(
      'toolExecuteJavaScript',
      isZh ? '执行 JavaScript' : 'Execute JavaScript',
    ),
    toolUploadImage: p('toolUploadImage', isZh ? '上传图片' : 'Upload image'),
    toolStepOf: (current, total) =>
      isZh
        ? `第 ${current} 步，共 ${total} 步`
        : `Step ${current} of ${total}`,
    languageChangeConfirm: p(
      'languageChangeConfirm',
      isZh
        ? '更改语言将开始新的对话。'
        : 'Changing the language will start a new chat.',
    ),
    languageChangeConfirmTitle: p(
      'languageChangeConfirmTitle',
      isZh ? '更改语言？' : 'Change language?',
    ),
    confirm: p('confirm', isZh ? '确认' : 'Confirm'),

    newPermissionsRequired: p('newPermissionsRequired', 'New permissions required'),
    permission: p('permission', 'Permission'),
    claudeWantsTo: (verb) =>
      isZh ? `Claude 想要${verb}：` : `Claude wants to ${verb}:`,
    claudeWantsApproval: p('claudeWantsApproval', 'Claude wants your approval to:'),
    allowOnce: p('allowOnce', 'Allow once'),
    // Official CZ primary: "Allow this action" (MCP remote uses "Allow once")
    allowThisAction: p('allowThisAction', 'Allow this action'),
    decline: p('decline', 'Decline'),
    approvePlan: p('approvePlan', 'Approve plan'),
    makeChanges: p('makeChanges', 'Make changes'),
    alwaysAllowSite: p('alwaysAllowSite', 'Always allow actions on this site'),
    browseClickType: p('browseClickType', 'Browse, click, and type'),
    sitePermissionsDisabled: p(
      'sitePermissionsDisabled',
      'Site-level permissions are disabled for this site.',
    ),
    domainTransitionPaused: (fromDomain, toDomain) =>
      isZh
        ? `Claude 因从 ${fromDomain} 导航到 ${toDomain} 而暂停`
        : `Claude paused due to a navigation from ${fromDomain} to ${toDomain}`,
    domainTransitionContinue: p('domainTransitionContinue', isZh ? '继续' : 'Continue'),
    domainTransitionStop: p('domainTransitionStop', isZh ? '停止' : 'Stop'),
    domainTransitionAlways: p(
      'domainTransitionAlways',
      isZh ? '始终继续' : 'Always continue',
    ),
    domainTransitionAlwaysHint: p(
      'domainTransitionAlwaysHint',
      isZh ? '在这些网站之间导航时' : 'When navigating between these sites',
    ),
    sectionDomainTransitions: p(
      'sectionDomainTransitions',
      isZh ? '跨站导航授权' : 'Domain transitions',
    ),
    sectionDomainTransitionsNote: p(
      'sectionDomainTransitionsNote',
      isZh
        ? '“始终继续”记住的 from → to 站点对。可在此撤销。'
        : 'Always-continue pairs (from → to). Revoke any you no longer want.',
    ),
    convertToTaskFailed: p(
      'convertToTaskFailed',
      isZh ? '创建任务失败，请重试。' : 'Failed to create scheduled task. Please try again.',
    ),
    // Official eS (update_plan) — keep EN title "Claude's plan" like the official ZH pack.
    claudePlanTitle: p('claudePlanTitle', 'Claude’s plan'),
    planAllowSites: p(
      'planAllowSites',
      isZh ? '允许在这些网站上执行操作' : 'Allow actions on these sites',
    ),
    planApproach: p('planApproach', isZh ? '遵循的方法' : 'Approach to follow'),
    planFooter: p(
      'planFooter',
      isZh
        ? 'Claude 将仅使用列出的网站。访问其他内容前会询问您。'
        : "Claude will only use the sites listed. You'll be asked before accessing anything else.",
    ),
    planApproved: p('planApproved', isZh ? '计划已批准' : 'Plan approved'),
    planRejected: p('planRejected', isZh ? '已拒绝' : 'Rejected'),
    // Official gM update_plan stream labels
    creatingPlan: p('creatingPlan', isZh ? '正在创建计划...' : 'Creating plan...'),
    createdPlan: p('createdPlan', isZh ? '创建了计划' : 'Created a plan'),
    planRejectedRow: p(
      'planRejectedRow',
      isZh ? '计划被拒绝' : 'Plan rejected',
    ),
    planLabel: p('planLabel', isZh ? '计划' : 'Plan'),
    // Official YC: "Batch — {completed}/{total} actions"
    batchActions: (completed, total) =>
      isZh
        ? `批处理 — ${completed}/${total} 个操作`
        : `Batch — ${completed}/${total} actions`,
    batchStoppedOnError: p(
      'batchStoppedOnError',
      isZh ? '因错误停止' : 'Stopped on error',
    ),
    textToBeTyped: p('textToBeTyped', isZh ? '要输入的文本：' : 'Text to be typed:'),
    permissionFooter: footerParts.before,
    settingsLink: footerParts.link,
    permissionFooterAfter: footerParts.after,
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

    hideSteps: p('hideSteps', isZh ? '隐藏步骤' : 'Hide steps'),
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
    sectionKeyboard: p('sectionKeyboard', isZh ? '键盘快捷键' : 'Keyboard shortcut'),
    sectionKeyboardNote: p(
      'sectionKeyboardNote',
      isZh
        ? '在 Chrome 扩展快捷键页配置打开侧栏的组合键。'
        : (EN_EXTRA.sectionKeyboardNote as string),
    ),
    openKeyboardShortcuts: p(
      'openKeyboardShortcuts',
      isZh ? '打开快捷键设置' : 'Open shortcut settings',
    ),
    sectionNotifications: p('sectionNotifications', isZh ? '通知' : 'Notifications'),
    sectionNotificationsNote: p(
      'sectionNotificationsNote',
      isZh
        ? '任务完成或需要你确认时，是否弹出系统通知。'
        : (EN_EXTRA.sectionNotificationsNote as string),
    ),
    notificationsEnabledLabel: p(
      'notificationsEnabledLabel',
      isZh ? '任务完成时通知我' : 'Notify me when tasks complete',
    ),
    notificationsEnabledHint: p(
      'notificationsEnabledHint',
      isZh
        ? '关闭后不再显示侧栏顶部的通知提示条。'
        : (EN_EXTRA.notificationsEnabledHint as string),
    ),
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
    tabGroupOnboardingNext: p(
      'tabGroupOnboardingNext',
      isZh ? '下一步' : 'Next',
    ),
    tabGroupActiveTitle: p(
      'tabGroupActiveTitle',
      isZh
        ? 'Claude 在此标签组中处于活动状态'
        : 'Claude is active in this tab group',
    ),
    tabGroupActiveBody: p(
      'tabGroupActiveBody',
      isZh
        ? 'Claude 可以跨站点研究、比较信息或处理多标签页任务。'
        : EN_EXTRA.tabGroupActiveBody!,
    ),
    tabGroupOpenChat: p('tabGroupOpenChat', isZh ? '打开聊天' : 'Open chat'),
    notifyBannerBody: p(
      'notifyBannerBody',
      isZh
        ? '当任务完成或需要输入时获得通知'
        : 'Get notified when tasks complete or need input',
    ),
    notifyMe: p('notifyMe', isZh ? '通知我' : 'Notify me'),
    dismissBanner: p('dismissBanner', isZh ? '忽略' : 'Dismiss'),
    notifyDoneTitle: p('notifyDoneTitle', isZh ? 'Claude 已完成' : 'Claude is done'),
    notifyDoneBody: p(
      'notifyDoneBody',
      isZh
        ? '您的任务已完成。准备好检查了吗？'
        : 'Your task is completed. Ready to check in?',
    ),
    automateRepetitive: p('automateRepetitive', 'Automate your repetitive tasks'),
    claudeCowork: p('claudeCowork', 'Claude Cowork'),
    switchBackClassic: p('switchBackClassic', 'Switch back to classic'),
    coworkUnavailableTitle: p('coworkUnavailableTitle', 'Claude Cowork'),
    coworkUnavailableBody: p('coworkUnavailableBody', EN_EXTRA.coworkUnavailableBody!),
    coworkOpenClaudeAi: p('coworkOpenClaudeAi', 'Open claude.ai'),
    pairingTitle: p('pairingTitle', EN_EXTRA.pairingTitle!),
    pairingBody: p('pairingBody', EN_EXTRA.pairingBody!),
    pairingGotIt: p('pairingGotIt', 'Got it'),
    pairingWantsToConnect: (client: string) =>
      p(
        'pairingWantsToConnect',
        isZh ? '{client} 想要连接' : '{client} wants to connect',
      ).replace('{client}', client),
    pairingNameBrowser: p(
      'pairingNameBrowser',
      isZh
        ? '为这台浏览器命名，方便之后识别。'
        : EN_EXTRA.pairingNameBrowser!,
    ),
    pairingNamePlaceholder: p(
      'pairingNamePlaceholder',
      isZh
        ? '例如：“公司电脑”、“个人 Chrome”'
        : EN_EXTRA.pairingNamePlaceholder!,
    ),
    pairingIgnore: p('pairingIgnore', isZh ? '忽略' : EN_EXTRA.pairingIgnore!),
    pairingConnect: p(
      'pairingConnect',
      isZh ? '连接' : EN_EXTRA.pairingConnect!,
    ),

    copyToClipboard: p(
      'copyToClipboard',
      isZh ? '复制到剪贴板' : EN_EXTRA.copyToClipboard!,
    ),
    codeCopied: p('codeCopied', isZh ? '已复制' : EN_EXTRA.codeCopied!),
    codeBlockLabel: p('codeBlockLabel', isZh ? '代码' : EN_EXTRA.codeBlockLabel!),
    mermaidRendering: p(
      'mermaidRendering',
      isZh ? '正在渲染图表…' : EN_EXTRA.mermaidRendering!,
    ),
    mermaidError: p('mermaidError', isZh ? '图表错误' : EN_EXTRA.mermaidError!),
    mermaidEmpty: p(
      'mermaidEmpty',
      isZh ? '空的 mermaid 图表' : EN_EXTRA.mermaidEmpty!,
    ),
    copyMessage: p('copyMessage', isZh ? '复制消息' : 'Copy message'),
    copy: p('copy', isZh ? '复制' : 'Copy'),
    copied: p('copied', isZh ? '已复制' : 'Copied'),
    scheduleOnce: p('scheduleOnce', isZh ? '一次' : 'Once'),
    scheduleDaily: p('scheduleDaily', isZh ? '每天' : 'Daily'),
    scheduleWeekly: p('scheduleWeekly', isZh ? '每周' : 'Weekly'),
    scheduleMonthly: p('scheduleMonthly', isZh ? '每月' : 'Monthly'),
    scheduleAnnually: p('scheduleAnnually', isZh ? '每年' : 'Annually'),
    scheduleStartFrom: p('scheduleStartFrom', isZh ? '开始于' : 'Start from'),
    scheduleTimePlaceholder: p(
      'scheduleTimePlaceholder',
      isZh ? '例如：9:30 AM 或 14:00' : 'e.g., 9:30 AM or 14:00',
    ),
    scheduleInvalidTime: p(
      'scheduleInvalidTime',
      isZh ? '无效的时间格式' : 'Invalid time format',
    ),
    createScheduledTask: p(
      'createScheduledTask',
      isZh ? '创建计划任务' : 'Create scheduled task',
    ),
    schedulePause: p('schedulePause', isZh ? '暂停' : 'Pause'),
    scheduleResume: p('scheduleResume', isZh ? '继续' : 'Resume'),
    noSchedulesYet: p('noSchedulesYet', isZh ? '暂无计划任务。' : 'No schedules yet.'),
    scheduleTitlePlaceholder: p(
      'scheduleTitlePlaceholder',
      isZh ? '标题' : 'Title',
    ),
    schedulePromptPlaceholder: p(
      'schedulePromptPlaceholder',
      isZh ? '任务触发时运行的提示词' : 'Prompt to run when the task fires',
    ),
    scheduleEveryMinutesFallback: (n) =>
      isZh ? `每 ${n} 分钟` : `every ${n} min`,
    scheduleDaySun: p('scheduleDaySun', isZh ? '周日' : 'Sun'),
    scheduleDayMon: p('scheduleDayMon', isZh ? '周一' : 'Mon'),
    scheduleDayTue: p('scheduleDayTue', isZh ? '周二' : 'Tue'),
    scheduleDayWed: p('scheduleDayWed', isZh ? '周三' : 'Wed'),
    scheduleDayThu: p('scheduleDayThu', isZh ? '周四' : 'Thu'),
    scheduleDayFri: p('scheduleDayFri', isZh ? '周五' : 'Fri'),
    scheduleDaySat: p('scheduleDaySat', isZh ? '周六' : 'Sat'),
    scheduleDatePlaceholder: p(
      'scheduleDatePlaceholder',
      isZh ? 'YYYY-MM-DD' : 'YYYY-MM-DD',
    ),
    scheduleDayOfMonth: p(
      'scheduleDayOfMonth',
      isZh ? '每月第几天（1–31）' : 'Day of month (1–31)',
    ),
    scheduleMonthDay: p('scheduleMonthDay', 'MM-DD'),
    scheduleFrequency: p('scheduleFrequency', isZh ? '频率' : 'Frequency'),
    scheduleTime: p('scheduleTime', isZh ? '时间（HH:mm）' : 'Time (HH:mm)'),

    teachClaude: p('teachClaude', 'Teach Claude'),
    teachYourWorkflow: p('teachYourWorkflow', 'Teach Claude your workflow'),
    teachIntroBody: p('teachIntroBody', EN_EXTRA.teachIntroBody!),
    teachIntroBodyMic: p('teachIntroBodyMic', EN_EXTRA.teachIntroBodyMic!),
    teachStartRecording: p('teachStartRecording', 'Start recording'),
    teachEnableMic: p('teachEnableMic', 'Enable microphone'),
    teachSkipMic: p('teachSkipMic', isZh ? '不使用麦克风，直接开始' : 'Start without microphone'),
    teachMicDenied: p(
      'teachMicDenied',
      isZh
        ? '麦克风权限被拒绝。你仍可无语音录制点击，或在设置页允许麦克风。'
        : EN_EXTRA.teachMicDenied!,
    ),
    teachMicAllowHint: p(
      'teachMicAllowHint',
      isZh
        ? '请选择「在访问该网站时允许」，以便 Teach Claude 能持续使用语音旁白。'
        : EN_EXTRA.teachMicAllowHint!,
    ),
    teachMicBanner: p(
      'teachMicBanner',
      isZh
        ? '启用麦克风以进行语音旁白。当前正在无语音录制。'
        : EN_EXTRA.teachMicBanner!,
    ),
    teachGrantMic: p('teachGrantMic', isZh ? '允许麦克风' : 'Allow microphone'),
    teachGrantMicHint: p(
      'teachGrantMicHint',
      isZh
        ? '用于录制流程时的可选语音旁白。不授权也能录制点击。'
        : EN_EXTRA.teachGrantMicHint!,
    ),
    teachMicStatusGranted: p(
      'teachMicStatusGranted',
      isZh ? '已允许麦克风' : 'Microphone allowed',
    ),
    teachMicStatusDenied: p(
      'teachMicStatusDenied',
      isZh
        ? '麦克风被拦截 — 请在站点控件中允许或重试'
        : EN_EXTRA.teachMicStatusDenied!,
    ),
    teachMicStatusPrompt: p(
      'teachMicStatusPrompt',
      isZh ? '尚未启用麦克风' : 'Microphone not enabled yet',
    ),
    teachRecording: p('teachRecording', 'Recording'),
    teachPaused: p('teachPaused', 'Paused'),
    teachPause: p('teachPause', 'Pause'),
    teachResume: p('teachResume', 'Resume'),
    teachStop: p('teachStop', 'Stop'),
    teachDiscard: p('teachDiscard', 'Discard'),
    teachDone: p('teachDone', 'Done'),
    teachVoice: p('teachVoice', 'Voice'),
    teachVoiceOn: p('teachVoiceOn', 'Listening…'),
    teachClickHint: p(
      'teachClickHint',
      'Click through your task to record each step',
    ),
    teachStep: p('teachStep', 'step'),
    teachSteps: p('teachSteps', 'steps'),
    teachSaveTitle: p('teachSaveTitle', 'Save workflow'),
    teachNameLabel: p('teachNameLabel', 'Name'),
    teachSaveAndRun: p('teachSaveAndRun', 'Save & run'),
    teachSaveOnly: p('teachSaveOnly', 'Save only'),
    teachSaveAsShortcut: p('teachSaveAsShortcut', 'Save as shortcut'),
    teachSaveAsTeachClaude: p(
      'teachSaveAsTeachClaude',
      isZh ? '保存为“教 Claude”' : 'Save as Teach Claude',
    ),
    teachGenerating: p('teachGenerating', 'Generating…'),
    teachLoading: p('teachLoading', 'Loading…'),
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

    sectionMcp: p('sectionMcp', 'Desktop & Claude Code (MCP)'),
    sectionMcpNote: p(
      'sectionMcpNote',
      'When Claude Desktop or Claude Code is installed with the browser extension host, they can drive this extension over native messaging (open MCP). Tools run in a yellow “Claude (MCP)” tab group (separate from the orange side-panel “Claude” group). Cloud pairing via claude.ai is not used — only the native host bridge.',
    ),
    mcpHostInstalled: p('mcpHostInstalled', 'Native host connected'),
    mcpHostMissing: p(
      'mcpHostMissing',
      'No native host found. Install Claude Desktop or Claude Code, then click Reconnect. (openclaude-local is an API companion only and does not provide the tool bridge.)',
    ),
    mcpSessionConnected: p('mcpSessionConnected', 'MCP session active'),
    mcpSessionIdle: p(
      'mcpSessionIdle',
      'Host present — waiting for an MCP session from Desktop / Claude Code',
    ),
    mcpRefresh: p('mcpRefresh', 'Refresh status'),
    mcpReconnect: p('mcpReconnect', 'Reconnect'),
    mcpHostLabel: (label) =>
      isZh ? `宿主：${label}` : `Host: ${label}`,
    mcpPermissionHint: p(
      'mcpPermissionHint',
      'When Desktop / Claude Code needs a grant, a focused 600×600 permission popup opens (official mcpPermissionOnly). MCP ignores chat Always / “Act without asking”; each action is once + retry. Nested browser_batch steps only run if already allowed — first-time grants must be standalone.',
    ),
    mcpGroupHint: p(
      'mcpGroupHint',
      'While a session is active, tabs leaving the yellow MCP group are detached from the debugger automatically (official hygiene).',
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

/**
 * Official Claude in Chrome 1.0.81 (constants-CDphNmxK `k`):
 *   1. exact match on navigator.language against supported packs
 *   2. else first pack whose prefix is `lang-`
 *   3. else en-US
 *
 * We also accept chrome.i18n.getUILanguage() and our extra packs (zh/ru).
 */
export function detectBrowserUiLocale(): UiLocale {
  const candidates: string[] = [];
  try {
    if (typeof navigator !== 'undefined') {
      if (navigator.language) candidates.push(navigator.language);
      if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      candidates.push(chrome.i18n.getUILanguage());
    }
  } catch {
    /* ignore */
  }

  const supported = Object.keys(PACKS) as UiLocale[];

  for (const raw of candidates) {
    if (!raw) continue;
    const exact = raw.replace('_', '-');
    if ((PACKS as Record<string, Pack>)[exact]) return exact as UiLocale;
    // Case-insensitive exact (zh-cn → need normalize)
    const norm = normalizeUiLocale(exact);
    // Only accept normalize result if it actually relates to the tag
    // (normalize always returns something; prefer prefix match like official)
    const lower = exact.toLowerCase();
    if (lower === norm.toLowerCase()) return norm;
    if (lower.startsWith('zh') || lower.startsWith('ja') || lower.startsWith('ko') ||
        lower.startsWith('de') || lower.startsWith('fr') || lower.startsWith('es') ||
        lower.startsWith('pt') || lower.startsWith('it') || lower.startsWith('ru') ||
        lower.startsWith('hi') || lower.startsWith('id') || lower.startsWith('en')) {
      return norm;
    }
  }

  // Official fallback path: lang prefix → first supported `lang-*`
  for (const raw of candidates) {
    if (!raw) continue;
    const lang = raw.replace('_', '-').split('-')[0]?.toLowerCase();
    if (!lang) continue;
    const hit = supported.find((id) => id.toLowerCase().startsWith(`${lang}-`));
    if (hit) return hit;
  }

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

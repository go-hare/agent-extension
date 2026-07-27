/**
 * Patch src/i18n/locales/*.json with native strings for EN-only official hashes.
 * Runtime also applies the same overrides via CRITICAL_OVERRIDES in ui.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/i18n/locales');

const overrides = {
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
  },
  'fr-FR': {
    beforeYouStart: 'Avant de commencer',
    beforeYouStartRisk:
      'Claude in Chrome peut effectuer des actions dans votre navigateur en votre nom. Cela comporte des risques distincts des autres produits Claude. Vous êtes responsable des actions realisees dans votre navigateur.',
    beforeYouStartContinue: 'Continuer',
    keyboardShortcut: 'Raccourci clavier',
    askBeforeActingDesc: "Claude planifie son approche avant d'agir.",
    actWithoutAskingDesc: "Claude travaille sans s'arreter pour demander une approbation.",
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Revenir au classique',
    openSettings: 'Ouvrir les parametres',
  },
  'es-ES': {
    beforeYouStart: 'Antes de empezar',
    beforeYouStartRisk:
      'Claude in Chrome puede realizar acciones en tu navegador en tu nombre. Esto conlleva riesgos distintos de otros productos de Claude. Eres responsable de las acciones realizadas en tu navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atajo de teclado',
    askBeforeActingDesc: 'Claude planifica su enfoque antes de actuar.',
    actWithoutAskingDesc: 'Claude trabaja sin detenerse para pedir aprobacion.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Volver al clasico',
    openSettings: 'Abrir configuracion',
  },
  'es-419': {
    beforeYouStart: 'Antes de empezar',
    beforeYouStartRisk:
      'Claude in Chrome puede realizar acciones en tu navegador en tu nombre. Esto conlleva riesgos distintos de otros productos de Claude. Eres responsable de las acciones realizadas en tu navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atajo de teclado',
    askBeforeActingDesc: 'Claude planifica su enfoque antes de actuar.',
    actWithoutAskingDesc: 'Claude trabaja sin detenerse para pedir aprobacion.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Volver al clasico',
    openSettings: 'Abrir configuracion',
  },
  'pt-BR': {
    beforeYouStart: 'Antes de comecar',
    beforeYouStartRisk:
      'O Claude in Chrome pode realizar acoes no seu navegador em seu nome. Isso traz riscos distintos de outros produtos Claude. Voce e responsavel pelas acoes realizadas no navegador.',
    beforeYouStartContinue: 'Continuar',
    keyboardShortcut: 'Atalho de teclado',
    askBeforeActingDesc: 'O Claude planeja a abordagem antes de agir.',
    actWithoutAskingDesc: 'O Claude trabalha sem pausar para pedir aprovacao.',
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Voltar ao classico',
    openSettings: 'Abrir configuracoes',
  },
  'it-IT': {
    beforeYouStart: 'Prima di iniziare',
    beforeYouStartRisk:
      'Claude in Chrome puo compiere azioni nel browser per tuo conto. Cio comporta rischi distinti da altri prodotti Claude. Sei responsabile delle azioni compiute nel browser.',
    beforeYouStartContinue: 'Continua',
    keyboardShortcut: 'Scorciatoia da tastiera',
    askBeforeActingDesc: "Claude pianifica l'approccio prima di agire.",
    actWithoutAskingDesc: "Claude lavora senza fermarsi per chiedere l'approvazione.",
    claudeCowork: 'Claude Cowork',
    switchBackClassic: 'Torna al classico',
    openSettings: 'Apri impostazioni',
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
  },
};

const en = JSON.parse(fs.readFileSync(path.join(dir, 'en-US.json'), 'utf8'));
const crit = [
  'beforeYouStart',
  'keyboardShortcut',
  'switchBackClassic',
  'askBeforeActingDesc',
  'actWithoutAskingDesc',
  'beforeYouStartRisk',
  'openSettings',
];

for (const [loc, ov] of Object.entries(overrides)) {
  const file = path.join(dir, `${loc}.json`);
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(pack, ov);
  const sorted = Object.fromEntries(
    Object.entries(pack).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  const still = crit.filter((k) => pack[k] === en[k]);
  console.log(loc, still.length ? `STILL EN: ${still.join('|')}` : 'OK native critical');
}

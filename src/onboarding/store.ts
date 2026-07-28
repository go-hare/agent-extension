/**
 * First-run / tip display counts (align official pin tip: show once).
 */

const KEY = 'onboarding_flags';

export interface OnboardingFlags {
  /** User accepted "Before you start" risk screen */
  beforeYouStartDone: boolean;
  /** Official IZ: "Claude has tab group access" full-screen step */
  tabGroupAccessShown: boolean;
  /** Pin tip already shown (maxDisplays: 1) */
  pinTipShown: boolean;
  /** User dismissed pairing explainer */
  pairingExplainerSeen: boolean;
}

const DEFAULTS: OnboardingFlags = {
  beforeYouStartDone: false,
  tabGroupAccessShown: false,
  pinTipShown: false,
  pairingExplainerSeen: false,
};

export async function loadOnboarding(): Promise<OnboardingFlags> {
  try {
    const raw = await chrome.storage.local.get(KEY);
    const v = raw[KEY] as Partial<OnboardingFlags> | undefined;
    return { ...DEFAULTS, ...v };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function patchOnboarding(
  patch: Partial<OnboardingFlags>,
): Promise<OnboardingFlags> {
  const cur = await loadOnboarding();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

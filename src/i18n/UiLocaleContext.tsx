/**
 * Locale for chrome UI (sidepanel / options).
 * Bound to Settings.locale — same switch as model reply language.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getUiStrings, type UiLocale, type UiStrings } from './ui';

const UiLocaleContext = createContext<UiStrings>(getUiStrings('en-US'));

export function UiLocaleProvider({
  locale,
  children,
}: {
  locale: UiLocale | string;
  children: ReactNode;
}) {
  const strings = useMemo(() => getUiStrings(locale), [locale]);
  return <UiLocaleContext.Provider value={strings}>{children}</UiLocaleContext.Provider>;
}

export function useUi(): UiStrings {
  return useContext(UiLocaleContext);
}

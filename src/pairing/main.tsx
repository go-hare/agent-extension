/**
 * Official pairing-DPmYBcVI.js entry:
 *   ?request_id=&client_type=&current_name=
 * Confirm → pairing_confirmed; dismiss → pairing_dismissed; then close tab.
 */

import '@/styles/theme.css';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapTheme, applyMode } from '@/sidepanel/theme';
import { PairingPrompt } from './PairingPrompt';
import { UiLocaleProvider } from '@/i18n/UiLocaleContext';
import { loadSettings } from '@/storage/settings';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';

bootstrapTheme();

function closeThisTab(): void {
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id != null) {
      void chrome.tabs.remove(tab.id).catch(() => {});
    }
  });
}

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get('request_id') || '';
  const clientType = params.get('client_type') || 'desktop';
  const currentName = params.get('current_name') || undefined;

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      applyMode(s.mode);
    });
  }, []);

  return (
    <UiLocaleProvider locale={settings.locale}>
      <div className="flex items-center justify-center min-h-screen bg-bg-100 p-4">
        <div className="w-full max-w-md">
          <PairingPrompt
            requestId={requestId}
            clientType={clientType}
            currentName={currentName}
            onConfirm={(id, name) => {
              void chrome.runtime.sendMessage({
                type: 'pairing_confirmed',
                request_id: id,
                name,
              });
              setTimeout(closeThisTab, 100);
            }}
            onDismiss={(id) => {
              void chrome.runtime.sendMessage({
                type: 'pairing_dismissed',
                request_id: id,
              });
              setTimeout(closeThisTab, 100);
            }}
          />
        </div>
      </div>
    </UiLocaleProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}

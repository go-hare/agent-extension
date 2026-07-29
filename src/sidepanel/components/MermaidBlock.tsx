/**
 * Mermaid diagram block — Claude in Chrome 1.0.81 parity.
 *
 * Official: lazy-load mermaid.core, initialize with startOnLoad:false,
 * securityLevel:"sandbox", htmlLabels:false, theme:"base" + light/dark
 * themeVariables (Kj / Yj in sidepanel-CEYFzMrx.js).
 *
 * Re-renders when `document.documentElement.dataset.mode` flips light/dark.
 */

import { memo, useEffect, useId, useState } from 'react';
import { useUi } from '@/i18n/UiLocaleContext';

/** Official dark themeVariables (Kj). */
const THEME_DARK = {
  primaryTextColor: '#E5E5E5',
  lineColor: '#A1A1A1',
  primaryColor: 'transparent',
  primaryBorderColor: '#A1A1A1',
  secondaryColor: 'transparent',
  tertiaryColor: '#CC785C',
  actorTextColor: '#E5E5E5',
  actorLineColor: '#A1A1A1',
  signalColor: '#E5E5E5',
  signalTextColor: '#E5E5E5',
  noteBkgColor: '#2D2D2D',
  noteTextColor: '#E5E5E5',
  noteBorderColor: '#A1A1A1',
} as const;

/** Official light themeVariables (Yj). */
const THEME_LIGHT = {
  primaryTextColor: '#191919',
  lineColor: '#91918D',
  primaryColor: '#F0F0EB',
  primaryBorderColor: '#D9D8D5',
  secondaryColor: '#F5E6D8',
  tertiaryColor: '#CC785C',
  actorTextColor: '#191919',
  actorLineColor: '#91918D',
  signalColor: '#191919',
  signalTextColor: '#191919',
  noteBkgColor: '#F0F0EB',
  noteTextColor: '#191919',
  noteBorderColor: '#D9D8D5',
} as const;

const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'htmlLabels',
  'themeCSS',
  'fontFamily',
  'altFontFamily',
  'theme',
  'themeVariables',
] as const;

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let lastMode: 'light' | 'dark' | null = null;

function currentMode(): 'light' | 'dark' {
  const m = document.documentElement.dataset.mode;
  return m === 'dark' ? 'dark' : 'light';
}

/** Subscribe to data-mode changes on <html> (theme toggle). */
function useDocumentColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState(currentMode);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setMode(currentMode());
    sync();
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-mode') {
          sync();
          break;
        }
      }
    });
    obs.observe(root, { attributes: true, attributeFilter: ['data-mode'] });
    return () => obs.disconnect();
  }, []);

  return mode;
}

async function getMermaid(mode: 'light' | 'dark'): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const api = (mod.default ?? mod) as MermaidApi;
      return api;
    });
  }
  const api = await mermaidPromise;
  if (lastMode !== mode) {
    const fontFamily =
      getComputedStyle(document.body).fontFamily || 'sans-serif';
    api.initialize({
      startOnLoad: false,
      htmlLabels: false,
      maxTextSize: 20_000,
      maxEdges: 400,
      fontFamily,
      theme: 'base',
      themeVariables: mode === 'dark' ? THEME_DARK : THEME_LIGHT,
      securityLevel: 'sandbox',
      // Official locks these keys against diagram front-matter override.
      secure: [...SECURE_KEYS],
    });
    lastMode = mode;
  }
  return api;
}

function normalizeSource(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const t = useUi();
  const reactId = useId().replace(/:/g, '');
  const colorMode = useDocumentColorMode();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const source = normalizeSource(code);
    if (!source) {
      setPending(false);
      setError(t.mermaidEmpty);
      setSvg(null);
      return;
    }

    setPending(true);
    setError(null);

    void (async () => {
      try {
        const mermaid = await getMermaid(colorMode);
        const id = `mermaid-${reactId}-${Date.now().toString(36)}`;
        const { svg: out } = await mermaid.render(id, source);
        if (cancelled) return;
        setSvg(out);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setSvg(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId, colorMode, t.mermaidEmpty]);

  if (pending && !svg) {
    return (
      <div className="my-2 rounded-lg border-[0.5px] border-border-300 bg-bg-200 p-3 text-xs text-text-400">
        {t.mermaidRendering}
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border-[0.5px] border-border-300 bg-bg-200 p-2.5">
        <div className="mb-1 text-xs text-danger-000">
          {t.mermaidError}: {error}
        </div>
        <pre className="font-mono whitespace-pre-wrap text-[0.813rem] leading-[1.5] text-text-300">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-x-auto rounded-lg border-[0.5px] border-border-300 bg-bg-000 p-3 [&_svg]:max-w-full"
      // SVG from mermaid with securityLevel sandbox — no arbitrary HTML labels.
      dangerouslySetInnerHTML={{ __html: svg ?? '' }}
    />
  );
});

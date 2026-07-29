/**
 * Syntax highlight via refractor (official 1.0.81 uses refractor lazy chunk).
 * Common language pack only — keeps size closer to official common set.
 */

import { createElement, memo, type ReactNode } from 'react';
import { refractor } from 'refractor';
import type { Element, Root, RootContent, Text } from 'hast';

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  golang: 'go',
  kt: 'kotlin',
  dockerfile: 'docker',
};

function resolveLang(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const lang = LANG_ALIASES[key] ?? key;
  try {
    if (refractor.registered(lang)) return lang;
  } catch {
    /* ignore */
  }
  return null;
}

function hastToReact(node: RootContent | Root, key?: string | number): ReactNode {
  if (node.type === 'root') {
    return node.children.map((c, i) => hastToReact(c, i));
  }
  if (node.type === 'text') {
    return (node as Text).value;
  }
  if (node.type !== 'element') return null;
  const el = node as Element;
  const props: Record<string, unknown> = { key };
  if (el.properties) {
    for (const [k, v] of Object.entries(el.properties)) {
      if (v == null || v === false) continue;
      if (k === 'className' && Array.isArray(v)) {
        props.className = v.join(' ');
      } else if (k === 'class' && (typeof v === 'string' || Array.isArray(v))) {
        props.className = Array.isArray(v) ? v.join(' ') : v;
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        // Avoid injecting event handlers / style objects from hast.
        if (/^on/i.test(k) || k === 'style') continue;
        props[k === 'class' ? 'className' : k] = v;
      }
    }
  }
  const children = el.children?.map((c, i) => hastToReact(c, i));
  return createElement(el.tagName, props, ...(children ?? []));
}

export function highlightCode(code: string, languageHint?: string): ReactNode {
  const lang = resolveLang(languageHint);
  if (!lang) return code;
  try {
    const tree = refractor.highlight(code, lang);
    return hastToReact(tree);
  } catch {
    return code;
  }
}

export const HighlightedCode = memo(function HighlightedCode({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const nodes = highlightCode(code, language);
  return <code className={className}>{nodes}</code>;
});

export function languageFromClassName(className?: string): string | undefined {
  if (!className) return undefined;
  const m = /language-([a-zA-Z0-9_+-]+)/.exec(className);
  return m?.[1];
}

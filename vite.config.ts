import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './manifest.config';

/**
 * Styles come from vendored Claude in Chrome 1.0.81 CSS
 * (`src/styles/official-1.0.81.css`), not a local Tailwind rebuild.
 * Do not re-add `@tailwindcss/vite` — it would regenerate utilities and
 * diverge from the official class set the sidepanel classNames expect.
 */
export default defineConfig({
  plugins: [react(), crx({ manifest })],

  /**
   * ⚠️ 关掉 Vite 的 publicDir，**故意的**，别改回来。
   *
   * 默认行为下 `public/` 的内容会被**平铺**到 dist 根：
   * `public/fonts/x.woff2` → `dist/fonts/x.woff2`。
   * 而 @crxjs 用的是另一套规则：按 manifest 里声明的路径**原样**发射
   * （先在项目根找，找不到再去 publicDir 找），所以
   * `public/icons/icon-128.png` 会落在 `dist/public/icons/icon-128.png`。
   *
   * 两套同时生效 = 同一个文件出现在两个位置，而代码里的引用
   * （theme.css 的 `url('/public/fonts/…')`、`getURL('public/icons/…')`）
   * 只对其中一份有效，另一份是死文件。字体那份最阴：woff2 404 不会抛错，
   * 只会静默回退到系统无衬线体，然后人会花半天怀疑 @font-face 写错了。
   *
   * 关掉之后只剩 crxjs 一套规则：**dist 里的路径 = manifest 里写的路径**。
   * 代价是 `public/` 下的资源必须在 manifest 里声明（icons 或
   * web_accessible_resources）才会进包 —— 这其实是好事，没人引用的资源
   * 不该悄悄打进去。
   */
  publicDir: false,

  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },

  build: {
    target: 'chrome116',
    // 扩展页面的 chunk 名不能带 hash 之外的怪字符；保持 assets/ 布局与原版一致
    rollupOptions: {
      // Official 1.0.81 extra pages (pairing / gif_viewer / offscreen / blocked / arc).
      // crxjs merges these with sidepanel + options + SW + content scripts.
      input: {
        pairing: resolve(import.meta.dirname, 'src/pairing/index.html'),
        gif_viewer: resolve(import.meta.dirname, 'src/gif_viewer/index.html'),
        offscreen: resolve(import.meta.dirname, 'src/offscreen/index.html'),
        blocked: resolve(import.meta.dirname, 'src/blocked/index.html'),
        arc: resolve(import.meta.dirname, 'src/arc/index.html'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },

  server: {
    port: 5199,
    strictPort: true,
    hmr: { port: 5199 },
  },

  // Anthropic SDK 在浏览器里跑需要 shim 掉 node 判定
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
});

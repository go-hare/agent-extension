/**
 * 配置页入口。
 *
 * 和侧栏共用同一份 theme.css 和主题引导逻辑 —— 配置页跟侧栏的主题不一致
 * 会让人以为打开了别的扩展。
 */

import '@/styles/theme.css';

import { createRoot } from 'react-dom/client';
import { Options } from './Options';
import { bootstrapTheme } from '@/sidepanel/theme';
import { loadSettings, watchSettings } from '@/storage/settings';

bootstrapTheme();
void loadSettings();
watchSettings();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from options/index.html');
}

createRoot(container).render(<Options />);

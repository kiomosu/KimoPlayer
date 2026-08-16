import { defineConfig } from 'vite';
import fs from 'node:fs';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Tauri production uses a custom asset protocol; relative URLs keep CSS,
  // JS and images resolvable both in dev and inside the installed bundle.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  plugins: [
    {
      name: 'cleanup-dev-fonts',
      // 思源黑体改为首次启动应用内下载，不进安装包：
      // public/fonts 仅供 dev 模式 CSS @font-face 使用，构建后从 dist 移除，避免打进前端资源
      closeBundle() {
        fs.rmSync('dist/fonts', { recursive: true, force: true });
      },
    },
  ],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        metadata: 'metadata.html',
        desktopLyrics: 'desktop-lyrics.html',
        debug: 'debug.html',
        trayWindow: 'tray-window.html',
      }
    }
  },
  esbuild: {
    drop: ['console', 'debugger'],
  },
});

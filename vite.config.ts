import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// 部署到 GitHub Pages 的 https://<user>.github.io/jp-renshuu/
// repo 改名的話這裡要跟著改，否則上線會是白畫面。
const BASE = '/jp-renshuu/'

// 版本資訊做進畫面裡，才能一眼看出 iPad 上跑的是哪一版
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      injectManifest: {
        // strokes.json 也要進 precache，不然離線練不了手寫
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: '日文練習本',
        short_name: '日文',
        description: '銘傳國企一甲日文一（上）的假名、單字與手寫練習',
        lang: 'zh-Hant',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        // 手寫要橫豎都能用，不鎖方向
        background_color: '#EEF3EF',
        theme_color: '#EEF3EF',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['node_modules/**', 'dist/**'],
  },
})

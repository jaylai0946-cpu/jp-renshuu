import type { Theme } from '../types'

/** 瀏覽器網址列／狀態列的顏色，跟著 tokens.css 的 --bg */
const BAR_COLOR = { light: '#FFF7EA', dark: '#1E1A29' } as const

/**
 * 套用外觀設定。
 *
 * 「自動」不設 data-theme，交給 tokens.css 的 prefers-color-scheme。
 * index.html 的 inline script 在第一次繪製前做一樣的事，免得深色模式先閃白；
 * 這裡負責之後在設定頁切換、或同步帶進別台的設定。
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme

  // 兩個 meta 各管一種系統主題。手動指定時兩個都改成同一色，自動時還原
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((m) => {
    const media = m.getAttribute('media') ?? ''
    const systemDark = media.includes('dark')
    const resolved = theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme
    m.content = BAR_COLOR[resolved]
  })
}

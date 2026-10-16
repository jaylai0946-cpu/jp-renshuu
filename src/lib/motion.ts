/**
 * 動畫的共用小工具。全部用 CSS transition／keyframes 和 Web Animations API，不加套件。
 *
 * 系統設定「減少動態效果」時一律不動（CSS 那邊在 index.css 最後統一關掉）。
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** 輕輕彈一下（數字變了、拿到點數）。不支援 Web Animations 的瀏覽器就不動 */
export function bump(el: Element | null, scale = 1.12): void {
  if (!el || prefersReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return
  ;(el as HTMLElement).animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration: 260, easing: 'cubic-bezier(0.3, 1.4, 0.6, 1)' },
  )
}

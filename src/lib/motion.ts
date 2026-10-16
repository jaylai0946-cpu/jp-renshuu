import { createContext } from 'react'
import type { MotionStyle } from '../types'

/**
 * 動畫的共用小工具。全部用 CSS transition／keyframes 和 Web Animations API，不加套件。
 *
 * 遊戲化動畫是選配：設定裡選「遊戲化」才開（<html data-motion="game">），
 * 預設維持原本的樣子。系統設定「減少動態效果」時不論選哪個都不動。
 */

/** 元件用：現在是不是遊戲化動畫。App 依設定提供 */
export const GameMotion = createContext(false)

/** CSS 用：把設定寫到 <html data-motion>，動畫樣式都掛在這個屬性底下 */
export function applyMotion(motion: MotionStyle): void {
  if (motion === 'game') document.documentElement.dataset.motion = 'game'
  else delete document.documentElement.dataset.motion
}

function gameOn(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'game'
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** 輕輕彈一下（數字變了、拿到點數）。不支援 Web Animations 的瀏覽器就不動 */
export function bump(el: Element | null, scale = 1.12): void {
  if (!el || !gameOn() || prefersReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return
  ;(el as HTMLElement).animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration: 260, easing: 'cubic-bezier(0.3, 1.4, 0.6, 1)' },
  )
}

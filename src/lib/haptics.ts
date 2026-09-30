/**
 * 答對時的小震動。
 *
 * - Android（Chrome）：navigator.vibrate 直接用。
 * - iPhone：Safari 沒有 vibrate。唯一的路是 iOS 17.4 起的 `<input switch>`——
 *   切換它時系統會給一下觸覺回饋，但只在「使用者真的點了它的 label」時才會。
 *   所以選擇題的正確答案上面蓋一層透明 label（見 Round.tsx），程式碼叫 click() 沒用。
 * - iPad：沒有震動馬達，什麼都不會發生。
 */
export const HAPTIC_SWITCH_ID = 'jp-haptic-switch'

/** 夠短才叫「小幅」，太長會像手機來電 */
const TAP_MS = 12

export function vibrate(enabled: boolean): void {
  if (!enabled) return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(TAP_MS)
    }
  } catch {
    // 有些瀏覽器在沒有使用者手勢時會丟例外，震不了就算了
  }
}

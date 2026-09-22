/**
 * Web Speech API。iOS 上第一次要等 voices 載入，所以每次都重新挑一次日文的聲音。
 * 沒有日文語音的裝置會用系統預設唸，聽起來怪但不會爆掉。
 */
let warmed = false

export function speak(text: string, enabled = true): void {
  if (!enabled || !text) return
  try {
    if (!('speechSynthesis' in window)) return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    u.rate = 0.85
    const ja = speechSynthesis.getVoices().find((v) => /^ja/i.test(v.lang))
    if (ja) u.voice = ja
    speechSynthesis.speak(u)
  } catch {
    // 唸不出來不影響練習
  }
}

/** iOS 要有一次使用者手勢才肯發聲，第一次點畫面時呼叫。 */
export function warmUpSpeech(): void {
  if (warmed) return
  warmed = true
  try {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance('')
    u.volume = 0
    speechSynthesis.speak(u)
  } catch {
    // 忽略
  }
}

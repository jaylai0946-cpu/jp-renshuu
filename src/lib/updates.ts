/**
 * service worker 的更新處理。
 *
 * vite-plugin-pwa 產生的 registerSW.js 只負責註冊，新版裝好之後不會叫頁面重載，
 * 所以使用者第一次開只會在背景更新、要開第二次才看得到新畫面。
 * 這裡補上「新版一接手就重載」，並提供手動檢查的入口。
 */

export const BUILD_ID = __BUILD_ID__
export const BUILD_TIME = __BUILD_TIME__

let reloading = false

export function watchForUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 這個事件在新的 service worker 接手時觸發。擋掉重複觸發，
    // 否則舊版 Safari 會連續 reload 變成無限迴圈。
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

export type UpdateCheck =
  | { state: 'unsupported' }
  | { state: 'not-installed' }
  | { state: 'updating' }
  | { state: 'current' }
  | { state: 'error'; message: string }

/** 主動問伺服器有沒有新版。有的話 controllerchange 會接著把頁面重載。 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { state: 'unsupported' }
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return { state: 'not-installed' }

    await registration.update()
    return registration.installing || registration.waiting
      ? { state: 'updating' }
      : { state: 'current' }
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

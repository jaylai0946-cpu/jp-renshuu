import { afterEach, describe, expect, it, vi } from 'vitest'

describe('新版接手時的重載', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('有東西在跑（holdReload）就先不重載，全部放開後才補重載', async () => {
    const sw = new EventTarget()
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, reload }, configurable: true })

    const { holdReload, watchForUpdates } = await import('./updates')
    watchForUpdates()
    const releaseA = holdReload()
    const releaseB = holdReload()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    releaseA()
    expect(reload).not.toHaveBeenCalled()
    releaseB()
    expect(reload).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'location', { value: original, configurable: true })
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })
})

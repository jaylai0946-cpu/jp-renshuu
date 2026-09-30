import { afterEach, describe, expect, it, vi } from 'vitest'
import { vibrate } from './haptics'

function stub(fn: unknown) {
  Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true })
}

describe('vibrate', () => {
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate
  })

  it('有 navigator.vibrate 就短震一下', () => {
    const fn = vi.fn(() => true)
    stub(fn)
    vibrate(true)
    expect(fn).toHaveBeenCalledWith(12)
  })

  it('設定關掉就不震', () => {
    const fn = vi.fn(() => true)
    stub(fn)
    vibrate(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('iOS 沒有 vibrate 也不會壞', () => {
    expect(() => vibrate(true)).not.toThrow()
  })

  it('瀏覽器丟例外也吞掉', () => {
    stub(() => {
      throw new Error('blocked')
    })
    expect(() => vibrate(true)).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { addDays, isDayString, ymd } from './dates'

describe('ymd', () => {
  it('用本地時區，不會因為半夜跳到前一天', () => {
    // 台灣時間 2026-01-01 00:30 在 UTC 還是 2025-12-31
    expect(ymd(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })

  it('補零', () => {
    expect(ymd(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
})

describe('addDays', () => {
  it('跨月', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('跨年往回', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('閏年', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('加 0 不動', () => {
    expect(addDays('2026-09-22', 0)).toBe('2026-09-22')
  })
})

describe('isDayString', () => {
  it.each([
    ['2026-09-22', true],
    ['2026-9-22', false],
    ['', false],
    [null, false],
    [20260922, false],
  ])('%s -> %s', (input, expected) => {
    expect(isDayString(input)).toBe(expected)
  })
})

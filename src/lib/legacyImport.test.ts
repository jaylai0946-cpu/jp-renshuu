import { describe, expect, it } from 'vitest'
import { importLegacy } from './legacyImport'
import { streak } from './srs'

const TODAY = '2026-09-22'

/** Artifact 版 <script id="state"> 吐出來的東西長這樣 */
const LEGACY = JSON.stringify({
  v: 1,
  items: {
    'h:あ': { b: 4, due: '2026-09-25', seen: 6, wrong: 1 },
    'h:い': { b: 2, due: '2026-09-22', seen: 3, wrong: 0 },
    'w:わたし': { b: 6, due: '2026-10-20', seen: 9, wrong: 0 },
  },
  hist: {
    '2026-09-22': { n: 12, c: 10, xp: 110, w: 1 },
    '2026-09-21': { n: 15, c: 12, xp: 135, w: 0 },
    '2026-09-20': { n: 15, c: 14, xp: 148, w: 2 },
  },
  settings: { newPerDay: 15, romaji: false, sound: true },
  newDay: { d: '2026-09-22', n: 8 },
  updatedAt: 1758500000000,
})

describe('importLegacy', () => {
  it('熟練度原封不動搬過來', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.items['h:あ']).toEqual({ b: 4, due: '2026-09-25', seen: 6, wrong: 1 })
    expect(r.state.items['w:わたし'].b).toBe(6)
    expect(r.matched).toBe(3)
    expect(r.dropped).toBe(0)
  })

  it('連續天數算得出來', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(streak(r.state, TODAY)).toBe(3)
  })

  it('設定跟著搬，新欄位補預設值', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.settings).toMatchObject({ newPerDay: 15, romaji: false, sound: true })
    // 舊版沒有這兩個
    expect(r.state.settings.penOnly).toBe(true)
    expect(r.state.settings.writePerDay).toBe(0)
  })

  it('今天的新字額度跟著搬，不會又重新給 10 個', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.newDay).toEqual({ d: '2026-09-22', n: 8 })
  })

  it('舊版沒有的手寫進度是空的', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.write).toEqual({})
  })

  it('hist 補上手寫欄位', () => {
    const r = importLegacy(LEGACY, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.hist['2026-09-22']).toEqual({ n: 12, c: 10, xp: 110, w: 1, h: 0 })
  })

  it('題庫裡沒有的字丟掉，並回報丟了幾個', () => {
    const r = importLegacy(
      JSON.stringify({ v: 1, items: { 'h:あ': { b: 1, due: TODAY }, 'h:廃': { b: 1, due: TODAY } } }),
      TODAY,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matched).toBe(1)
    expect(r.dropped).toBe(1)
    expect(r.state.items['h:廃']).toBeUndefined()
  })

  it.each([
    ['', '沒有貼上任何東西'],
    ['   ', '沒有貼上任何東西'],
    ['not json', '不是合法的 JSON'],
    ['[1,2,3]', '不是一個物件'],
    ['{"v":1}', '找不到 items'],
  ])('%s 要擋下來', (input, fragment) => {
    const r = importLegacy(input, TODAY)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain(fragment)
  })

  it('一個字都對不上就整包不收，不要假裝匯入成功', () => {
    const r = importLegacy(JSON.stringify({ v: 1, items: { 'h:廃': { b: 1 } } }), TODAY)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('沒有一個字對得上')
  })

  it('壞掉的欄位補預設值，不整包丟掉', () => {
    const r = importLegacy(
      JSON.stringify({
        v: 1,
        items: { 'h:あ': { b: 99, due: '亂七八糟', seen: -5, wrong: null } },
        settings: { newPerDay: 'abc' },
      }),
      TODAY,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.items['h:あ']).toEqual({ b: 6, due: TODAY, seen: 0, wrong: 0 })
    expect(r.state.settings.newPerDay).toBe(10)
  })
})

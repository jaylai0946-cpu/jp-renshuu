import { describe, expect, it } from 'vitest'
import { DAKU, ITEMS, SEION, UNITS, YOON, handwritingChars, toKata } from './units'

describe('五十音資料', () => {
  it('清音 46、濁音半濁音 25、拗音 33', () => {
    expect(SEION).toHaveLength(46)
    expect(DAKU).toHaveLength(25)
    expect(YOON).toHaveLength(33)
  })

  it('拗音的羅馬拼音：sh/ch/j 後面不加 y', () => {
    const map = Object.fromEntries(YOON)
    expect(map['きゃ']).toBe('kya')
    expect(map['しゃ']).toBe('sha')
    expect(map['ちゅ']).toBe('chu')
    expect(map['じょ']).toBe('jo')
    expect(map['にゃ']).toBe('nya')
    expect(map['ぴょ']).toBe('pyo')
  })

  it('讀音相同的字都留著（ぢ づ）', () => {
    const map = Object.fromEntries(DAKU)
    expect(map['じ']).toBe('ji')
    expect(map['ぢ']).toBe('ji')
    expect(map['ず']).toBe('zu')
    expect(map['づ']).toBe('zu')
  })
})

describe('toKata', () => {
  it('轉一般假名', () => {
    expect(toKata('あいうえお')).toBe('アイウエオ')
    expect(toKata('ん')).toBe('ン')
    expect(toKata('を')).toBe('ヲ')
  })

  it('小字也轉', () => {
    expect(toKata('きゃ')).toBe('キャ')
    expect(toKata('しゅ')).toBe('シュ')
  })

  it('不是平假名的字元不動', () => {
    expect(toKata('私 abc')).toBe('私 abc')
  })
})

describe('UNITS', () => {
  it('12 個單元，順序照 SPEC', () => {
    expect(UNITS.map((u) => u.id)).toEqual([
      'h1', 'h2', 'h3', 'v1', 'k1', 'v2', 'k2', 'v3', 'k3', 'v4', 'v5', 'v6',
    ])
  })

  it('每個單元都有題目', () => {
    for (const u of UNITS) expect(u.items.length).toBeGreaterThan(0)
  })

  it('id 前綴分得開平假名、片假名、單字', () => {
    expect(ITEMS['h:あ']).toBeDefined()
    expect(ITEMS['k:ア']).toBeDefined()
    expect(ITEMS['w:わたし']).toBeDefined()
    expect(ITEMS['h:ア']).toBeUndefined()
  })

  it('id 不重複', () => {
    const all = UNITS.flatMap((u) => u.items.map((i) => i.id))
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(283)
  })

  it('有漢字的詞 jp 是漢字，沒漢字的 jp 等於讀音', () => {
    const watashi = ITEMS['w:わたし']
    expect(watashi).toMatchObject({ t: 'word', jp: '私', kana: 'わたし', zh: '我', ro: 'watashi' })
    expect(ITEMS['w:こんにちは']).toMatchObject({ jp: 'こんにちは', kana: 'こんにちは' })
  })

  it('片假名單元用轉過的字', () => {
    expect(ITEMS['k:キャ']).toMatchObject({ ch: 'キャ', ro: 'kya', u: 'k3' })
  })
})

describe('handwritingChars', () => {
  it('148 個假名：平假名 74 + 片假名 74', () => {
    const chars = handwritingChars()
    expect(chars).toHaveLength(148)
  })

  it('拗音被拆成兩個字，小字獨立算一個', () => {
    const chars = handwritingChars()
    expect(chars).toContain('ゃ')
    expect(chars).toContain('ャ')
    expect(chars).not.toContain('きゃ')
  })

  it('不含漢字（第一版不練漢字手寫）', () => {
    for (const c of handwritingChars()) {
      expect(c.codePointAt(0)!).toBeLessThan(0x3100)
      expect(c.codePointAt(0)!).toBeGreaterThan(0x3040)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { ITEMS, UNIT_BY_ID } from '../data/units'
import type { AppState, Progress } from '../types'
import { emptyState } from './storage'
import {
  INTERVALS,
  MAX_REVIEW,
  buildRound,
  currentUnit,
  dueIds,
  makeQuestion,
  markKnownPatch,
  newProgress,
  nextNew,
  practiced,
  schedule,
  streak,
  writeDueIds,
} from './srs'

const TODAY = '2026-09-22'

/** 固定順序的亂數，測試才不會偶爾紅。 */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function withItems(entries: Record<string, Partial<Progress>>): AppState {
  const state = emptyState()
  for (const [id, p] of Object.entries(entries)) {
    state.items[id] = { b: 0, due: TODAY, seen: 0, wrong: 0, ...p }
  }
  return state
}

describe('schedule', () => {
  it('答對往上一格，間隔照 INTERVALS', () => {
    let p = newProgress(TODAY)
    p = schedule(p, true, TODAY)
    expect(p).toMatchObject({ b: 1, due: '2026-09-23', seen: 1, wrong: 0 })
    p = schedule(p, true, '2026-09-23')
    expect(p).toMatchObject({ b: 2, due: '2026-09-25' })
    p = schedule(p, true, '2026-09-25')
    expect(p).toMatchObject({ b: 3, due: '2026-09-29' })
  })

  it('盒子 6 封頂，間隔停在 32 天', () => {
    const p = schedule({ b: 6, due: TODAY, seen: 9, wrong: 1 }, true, TODAY)
    expect(p.b).toBe(6)
    expect(p.due).toBe('2026-10-24')
    expect(INTERVALS[6]).toBe(32)
  })

  it('答錯回盒子 1、明天再來，wrong +1', () => {
    const p = schedule({ b: 5, due: TODAY, seen: 9, wrong: 1 }, false, TODAY)
    expect(p).toMatchObject({ b: 1, due: '2026-09-23', seen: 10, wrong: 2 })
  })

  it('答錯不會掉回 0（掉回 0 明天又會當新字介紹一次）', () => {
    expect(schedule(newProgress(TODAY), false, TODAY).b).toBe(1)
  })
})

describe('dueIds', () => {
  it('只拿到期的，早到期的排前面', () => {
    const state = withItems({
      'h:あ': { due: '2026-09-22' },
      'h:い': { due: '2026-09-20' },
      'h:う': { due: '2026-09-30' },
    })
    expect(dueIds(state, TODAY)).toEqual(['h:い', 'h:あ'])
  })

  it('題庫裡沒有的 id 會被跳過', () => {
    const state = withItems({ 'h:あ': {} })
    state.items['w:這個字不存在'] = { b: 0, due: TODAY, seen: 0, wrong: 0 }
    expect(dueIds(state, TODAY)).toEqual(['h:あ'])
  })
})

describe('nextNew', () => {
  it('照單元順序、單元內照字序', () => {
    expect(nextNew(emptyState(), 3)).toEqual(['h:あ', 'h:い', 'h:う'])
  })

  it('跳過學過的', () => {
    const state = withItems({ 'h:あ': {}, 'h:い': {} })
    expect(nextNew(state, 2)).toEqual(['h:う', 'h:え'])
  })

  it('限定單元', () => {
    expect(nextNew(emptyState(), 2, 'v1')).toEqual(['w:おはようございます', 'w:こんにちは'])
  })

  it('學完了就回空陣列', () => {
    const state = emptyState()
    for (const id of Object.keys(ITEMS)) state.items[id] = newProgress(TODAY)
    expect(nextNew(state, 5)).toEqual([])
  })
})

describe('currentUnit', () => {
  it('全新的人從平假名清音開始', () => {
    expect(currentUnit(emptyState())?.id).toBe('h1')
  })

  it('h1 學完就換 h2', () => {
    const state = emptyState()
    for (const it of UNIT_BY_ID['h1'].items) state.items[it.id] = newProgress(TODAY)
    expect(currentUnit(state)?.id).toBe('h2')
  })
})

describe('markKnownPatch', () => {
  it('沒學過的整批放進盒子 3，四天後複習', () => {
    const patch = markKnownPatch(emptyState(), 'h1', TODAY)
    expect(Object.keys(patch)).toHaveLength(46)
    expect(patch['h:あ']).toEqual({ b: 3, due: '2026-09-26', seen: 0, wrong: 0 })
  })

  it('已經學過的不動', () => {
    const state = withItems({ 'h:あ': { b: 5 } })
    expect(markKnownPatch(state, 'h1', TODAY)['h:あ']).toBeUndefined()
  })
})

describe('writeDueIds', () => {
  it('辨識還沒到盒子 2 的不出手寫題', () => {
    const state = withItems({ 'h:あ': { b: 1 }, 'h:い': { b: 2 } })
    expect(writeDueIds(state, TODAY)).toEqual(['h:い'])
  })

  it('單字不出手寫題（第一版只練假名）', () => {
    const state = withItems({ 'w:わたし': { b: 5 } })
    expect(writeDueIds(state, TODAY)).toEqual([])
  })

  it('沒寫過的排在到期的前面', () => {
    const state = withItems({ 'h:あ': { b: 3 }, 'h:い': { b: 3 } })
    state.write['h:あ'] = { b: 2, due: '2026-09-01', seen: 3, wrong: 0 }
    expect(writeDueIds(state, TODAY)).toEqual(['h:い', 'h:あ'])
  })

  it('手寫還沒到期就不出', () => {
    const state = withItems({ 'h:あ': { b: 3 } })
    state.write['h:あ'] = { b: 4, due: '2026-10-30', seen: 3, wrong: 0 }
    expect(writeDueIds(state, TODAY)).toEqual([])
  })
})

describe('makeQuestion', () => {
  const alwaysReverse = () => 0.1
  const neverReverse = () => 0.9

  it('盒子 0 只出正向題', () => {
    const state = withItems({ 'h:あ': { b: 0 } })
    expect(makeQuestion('h:あ', state, alwaysReverse).mode).toBe('kana2ro')
  })

  it('盒子 2 以上才可能出反向題', () => {
    const state = withItems({ 'h:あ': { b: 2 } })
    expect(makeQuestion('h:あ', state, alwaysReverse).mode).toBe('ro2kana')
    expect(makeQuestion('h:あ', state, neverReverse).mode).toBe('kana2ro')
  })

  it('單字題的正反向', () => {
    const state = withItems({ 'w:わたし': { b: 3 } })
    expect(makeQuestion('w:わたし', state, neverReverse).mode).toBe('jp2zh')
    expect(makeQuestion('w:わたし', state, alwaysReverse)).toMatchObject({
      mode: 'zh2jp',
      answer: '私',
    })
  })

  it('四個選項，包含正確答案，沒有重複', () => {
    const state = withItems({ 'h:か': { b: 0 } })
    for (let seed = 1; seed <= 30; seed++) {
      const q = makeQuestion('h:か', state, seeded(seed))
      expect(q.choices).toHaveLength(4)
      expect(q.choices).toContain('ka')
      expect(new Set(q.choices).size).toBe(4)
    }
  })

  it('選項都來自同一個單元', () => {
    const state = withItems({ 'h:あ': { b: 0 } })
    const pool = new Set(UNIT_BY_ID['h1'].items.map((i) => i.ro))
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of makeQuestion('h:あ', state, seeded(seed)).choices) {
        expect(pool.has(c)).toBe(true)
      }
    }
  })

  it('問「ji 是哪個假名」時不會同時出 じ 和 ぢ', () => {
    const state = withItems({ 'h:じ': { b: 3 } })
    for (let seed = 1; seed <= 40; seed++) {
      const q = makeQuestion('h:じ', state, () => (seeded(seed)() > 0.5 ? 0.1 : 0.2))
      if (q.mode !== 'ro2kana') continue
      expect(q.choices).toContain('じ')
      expect(q.choices).not.toContain('ぢ')
    }
  })
})

describe('buildRound - 每日練習', () => {
  it('複習題最多 15 題', () => {
    const state = emptyState()
    for (const it of UNIT_BY_ID['h1'].items) {
      state.items[it.id] = { b: 1, due: '2026-09-01', seen: 1, wrong: 0 }
    }
    state.settings.newPerDay = 0
    state.settings.writePerDay = 0
    const queue = buildRound(state, { kind: 'daily' }, TODAY, seeded(7))
    expect(queue).toHaveLength(MAX_REVIEW)
  })

  it('沒有複習題時，新字補滿到每日上限', () => {
    const state = emptyState()
    state.settings.newPerDay = 10
    state.settings.writePerDay = 0
    const queue = buildRound(state, { kind: 'daily' }, TODAY, seeded(3))
    expect(queue).toHaveLength(10)
    expect(queue.every((q) => q.isNew)).toBe(true)
  })

  it('今天學過的新字要從額度裡扣掉', () => {
    const state = emptyState()
    state.settings.newPerDay = 10
    state.settings.writePerDay = 0
    state.newDay = { d: TODAY, n: 7 }
    expect(buildRound(state, { kind: 'daily' }, TODAY, seeded(3))).toHaveLength(3)
  })

  it('昨天的額度不會延續到今天', () => {
    const state = emptyState()
    state.settings.newPerDay = 10
    state.settings.writePerDay = 0
    state.newDay = { d: '2026-09-21', n: 10 }
    expect(buildRound(state, { kind: 'daily' }, TODAY, seeded(3))).toHaveLength(10)
  })

  it('默寫題不佔複習額度，另外算', () => {
    const state = emptyState()
    for (const it of UNIT_BY_ID['h1'].items) {
      state.items[it.id] = { b: 3, due: '2026-09-01', seen: 3, wrong: 0 }
    }
    state.settings.newPerDay = 0
    state.settings.writePerDay = 5
    const queue = buildRound(state, { kind: 'daily' }, TODAY, seeded(11))
    expect(queue.filter((q) => q.write)).toHaveLength(5)
    expect(queue.filter((q) => !q.write)).toHaveLength(MAX_REVIEW)
  })

  it('writePerDay 設 0 就完全不出默寫題', () => {
    const state = emptyState()
    for (const it of UNIT_BY_ID['h1'].items) {
      state.items[it.id] = { b: 3, due: '2026-09-01', seen: 3, wrong: 0 }
    }
    state.settings.writePerDay = 0
    const queue = buildRound(state, { kind: 'daily' }, TODAY, seeded(11))
    expect(queue.filter((q) => q.write)).toHaveLength(0)
  })

  it('什麼都沒到期就回空陣列', () => {
    const state = emptyState()
    for (const id of Object.keys(ITEMS)) {
      state.items[id] = { b: 6, due: '2026-12-31', seen: 9, wrong: 0 }
      state.write[id] = { b: 6, due: '2026-12-31', seen: 9, wrong: 0 }
    }
    expect(buildRound(state, { kind: 'daily' }, TODAY, seeded(1))).toEqual([])
  })

  it('辨識都熟了但從沒練過手寫，還是會出默寫題', () => {
    const state = emptyState()
    for (const id of Object.keys(ITEMS)) {
      state.items[id] = { b: 6, due: '2026-12-31', seen: 9, wrong: 0 }
    }
    state.settings.writePerDay = 5
    const queue = buildRound(state, { kind: 'daily' }, TODAY, seeded(1))
    expect(queue).toHaveLength(5)
    expect(queue.every((q) => q.write)).toBe(true)
  })
})

describe('buildRound - 單元練習', () => {
  it('只出這個單元的字', () => {
    const queue = buildRound(emptyState(), { kind: 'unit', unitId: 'v1' }, TODAY, seeded(5))
    expect(queue.length).toBeGreaterThan(0)
    for (const q of queue) expect(ITEMS[q.id].u).toBe('v1')
  })

  it('單元學完了就拿學過的來湊，不會只出兩題', () => {
    const state = emptyState()
    for (const it of UNIT_BY_ID['v1'].items) {
      state.items[it.id] = { b: 6, due: '2026-12-31', seen: 9, wrong: 0 }
    }
    const queue = buildRound(state, { kind: 'unit', unitId: 'v1' }, TODAY, seeded(5))
    expect(queue.length).toBeGreaterThanOrEqual(8)
  })

  it('不存在的單元回空陣列', () => {
    expect(buildRound(emptyState(), { kind: 'unit', unitId: 'zz' }, TODAY)).toEqual([])
  })
})

describe('streak', () => {
  it('今天還沒練，昨天有練，算 1 天', () => {
    const state = emptyState()
    state.hist['2026-09-21'] = { n: 5, c: 4, xp: 50, w: 0, h: 0 }
    expect(streak(state, TODAY)).toBe(1)
  })

  it('連續三天', () => {
    const state = emptyState()
    for (const d of ['2026-09-22', '2026-09-21', '2026-09-20']) {
      state.hist[d] = { n: 5, c: 4, xp: 50, w: 0, h: 0 }
    }
    state.hist['2026-09-18'] = { n: 5, c: 4, xp: 50, w: 0, h: 0 }
    expect(streak(state, TODAY)).toBe(3)
  })

  it('斷掉就歸零', () => {
    const state = emptyState()
    state.hist['2026-09-19'] = { n: 5, c: 4, xp: 50, w: 0, h: 0 }
    expect(streak(state, TODAY)).toBe(0)
  })

  it('只有手寫也算有練', () => {
    expect(practiced({ n: 0, c: 0, xp: 0, w: 0, h: 3 })).toBe(true)
    expect(practiced({ n: 0, c: 0, xp: 0, w: 0, h: 0 })).toBe(false)
  })
})

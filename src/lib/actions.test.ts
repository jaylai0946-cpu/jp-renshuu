import { describe, expect, it } from 'vitest'
import { XP_FIRST_CORRECT, answerQuestion } from './actions'
import { emptyState } from './storage'
import type { AppState, Progress } from '../types'

const TODAY = '2026-10-05'
const ID = 'h:あ'

function withItem(p: Progress): AppState {
  const s = emptyState()
  s.items[ID] = p
  return s
}

describe('answerQuestion：到期和沒到期', () => {
  it('到期的字答對：升一格，排到下一次', () => {
    const next = answerQuestion(withItem({ b: 2, due: TODAY, seen: 3, wrong: 0 }), ID, true, true, TODAY)
    expect(next.items[ID].b).toBe(3)
    expect(next.items[ID].due > TODAY).toBe(true)
  })

  it('還沒到期的字答對（隨機複習、單元練習）：盒子和到期日都不動', () => {
    const before = { b: 1, due: '2026-10-06', seen: 1, wrong: 0 }
    const next = answerQuestion(withItem(before), ID, true, true, TODAY)
    expect(next.items[ID]).toEqual(before)
  })

  it('還沒到期也照樣算進今天的答題數和點數', () => {
    const next = answerQuestion(withItem({ b: 1, due: '2026-10-06', seen: 1, wrong: 0 }), ID, true, true, TODAY)
    expect(next.hist[TODAY]).toMatchObject({ n: 1, c: 1, xp: XP_FIRST_CORRECT })
  })

  it('還沒到期的字答錯：照樣降級，明天再出', () => {
    const next = answerQuestion(withItem({ b: 4, due: '2026-10-20', seen: 9, wrong: 0 }), ID, false, true, TODAY)
    expect(next.items[ID]).toMatchObject({ b: 1, due: '2026-10-06', wrong: 1 })
  })

  it('同一個字當天複習很多次也不會一路升上去', () => {
    // 今天剛學、答對一次 → 盒子 1、明天到期
    let s = answerQuestion(withItem({ b: 0, due: TODAY, seen: 0, wrong: 0 }), ID, true, true, TODAY)
    expect(s.items[ID]).toMatchObject({ b: 1, due: '2026-10-06' })
    // 接著隨機複習三次，都答對
    for (let i = 0; i < 3; i++) s = answerQuestion(s, ID, true, true, TODAY)
    expect(s.items[ID]).toMatchObject({ b: 1, due: '2026-10-06' })
  })
})

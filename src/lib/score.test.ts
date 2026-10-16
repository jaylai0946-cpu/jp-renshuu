import { describe, expect, it } from 'vitest'
import type { InkPoint, Point } from './path'
import { scoreCharacter } from './score'
import { KANJIVG_SIZE, STROKE_PATHS, templateFor } from './strokes'
import { FINGER, PEN } from './thresholds'

const SIZE = 300
const K = SIZE / KANJIVG_SIZE

/** 把範本當成「寫得完美」的輸入：換算回畫布座標 */
function trace(ch: string, warp: (p: Point, i: number, stroke: number) => Point = (p) => p): InkPoint[][] {
  return templateFor(ch).map((stroke, s) =>
    stroke.map((p, i) => {
      const q = warp(p, i, s)
      return { x: q.x * K, y: q.y * K, pressure: 0.5 }
    }),
  )
}

function seeded(seed: number) {
  let v = seed
  return () => {
    v = (v * 1664525 + 1013904223) % 4294967296
    return v / 4294967296 - 0.5
  }
}

describe('照著範本寫', () => {
  it('完美描出來的あ判成 ◎', () => {
    const score = scoreCharacter('あ', trace('あ'), SIZE, PEN)
    expect(score.verdict).toBe('ok')
    expect(score.message).toContain('都對')
    expect(score.problemStrokes).toEqual([])
  })

  it('148 個假名完美描出來全部都是 ◎', () => {
    const bad = Object.keys(STROKE_PATHS).filter(
      (ch) => scoreCharacter(ch, trace(ch), SIZE, PEN).verdict !== 'ok',
    )
    expect(bad).toEqual([])
  })

  it('手抖一點還是 ◎（寬鬆門檻要真的寬鬆）', () => {
    const jitter = seeded(42)
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + jitter() * 8, y: p.y + jitter() * 8 })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('ok')
  })
})

describe('驗收標準：あ', () => {
  it('寫成 2 筆判成 ✕', () => {
    const two = trace('あ').slice(0, 2)
    const score = scoreCharacter('あ', two, SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('筆畫數不對')
    expect(score.expected).toBe(3)
    expect(score.actual).toBe(2)
  })

  it('寫成 4 筆也判成 ✕', () => {
    const strokes = trace('あ')
    const score = scoreCharacter('あ', [...strokes, strokes[0]], SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('筆畫數不對')
  })

  it('筆順顛倒判成 ✕', () => {
    const score = scoreCharacter('あ', [...trace('あ')].reverse(), SIZE, PEN)
    expect(score.verdict).toBe('bad')
  })

  it('筆順顛倒不會被誤報成「方向反了」', () => {
    const score = scoreCharacter('あ', [...trace('あ')].reverse(), SIZE, PEN)
    expect(score.message).toContain('筆順')
    expect(score.strokes[0].reversed).toBe(false)
  })

  it('照正確筆順寫判成 ◎', () => {
    expect(scoreCharacter('あ', trace('あ'), SIZE, PEN).verdict).toBe('ok')
  })
})

describe('方向寫反', () => {
  it('整筆從另一端起筆會被抓出來', () => {
    const strokes = trace('あ')
    strokes[0] = [...strokes[0]].reverse()
    const score = scoreCharacter('あ', strokes, SIZE, PEN)

    expect(score.verdict).toBe('bad')
    expect(score.strokes[0].reversed).toBe(true)
    expect(score.message).toContain('第 1 筆')
    expect(score.message).toContain('方向')
  })

  it('指出是第幾筆', () => {
    const strokes = trace('あ')
    strokes[1] = [...strokes[1]].reverse()
    expect(scoreCharacter('あ', strokes, SIZE, PEN).message).toContain('第 2 筆')
  })

  it('每一筆都寫反也抓得到', () => {
    const strokes = trace('い').map((s) => [...s].reverse())
    expect(scoreCharacter('い', strokes, SIZE, PEN).verdict).toBe('bad')
  })
})

describe('形狀偏掉', () => {
  it('整個字平移一點點判成 △，不是 ✕', () => {
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + 19, y: p.y })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('shape')
    expect(score.message).toContain('筆順對了')
  })

  it('△ 會標出是哪幾筆', () => {
    const strokes = trace('あ', (p, _i, s) => (s === 1 ? { x: p.x + 19, y: p.y } : p))
    const score = scoreCharacter('あ', strokes, SIZE, PEN)
    expect(score.verdict).toBe('shape')
    expect(score.problemStrokes).toEqual([2])
    expect(score.strokes[0].verdict).toBe('ok')
    expect(score.strokes[1].verdict).toBe('shape')
  })

  it('偏太多就變 ✕', () => {
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + 40, y: p.y + 40 })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('bad')
  })
})

describe('門檻', () => {
  it('手指的門檻比筆寬鬆：同一份輸入筆判 △、手指判 ◎', () => {
    const strokes = trace('あ', (p) => ({ x: p.x + 19, y: p.y }))
    expect(scoreCharacter('あ', strokes, SIZE, PEN).verdict).toBe('shape')
    expect(scoreCharacter('あ', strokes, SIZE, FINGER).verdict).toBe('ok')
  })

  it('畫布大小不影響結果（先換算到 109 再比）', () => {
    for (const size of [200, 300, 600]) {
      const k = size / KANJIVG_SIZE
      const strokes = templateFor('か').map((s) =>
        s.map((p) => ({ x: p.x * k, y: p.y * k, pressure: 0.5 })),
      )
      expect(scoreCharacter('か', strokes, size, PEN).verdict).toBe('ok')
    }
  })
})

describe('邊界情況', () => {
  it('一筆都沒寫', () => {
    const score = scoreCharacter('あ', [], SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.actual).toBe(0)
    expect(score.strokes).toEqual([])
  })

  it('只點了三個點（沒有真的畫）判成 ✕，不會爆掉', () => {
    const dots: InkPoint[][] = [1, 2, 3].map(() => [{ x: 150, y: 150, pressure: 0.5 }])
    const score = scoreCharacter('あ', dots, SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(Number.isFinite(score.strokes[0].shapeDistance)).toBe(true)
  })

  it('沒有筆順資料的字不會爆掉', () => {
    const score = scoreCharacter('漢', trace('あ'), SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('沒有筆順資料')
  })

  it('每一筆的分數都對齊使用者實際寫的筆數', () => {
    const score = scoreCharacter('あ', trace('あ'), SIZE, PEN)
    expect(score.strokes).toHaveLength(3)
  })
})

describe('相似字', () => {
  it('題目是 ね 卻寫成 れ：判 ✕，說像 れ', () => {
    const score = scoreCharacter('ね', trace('れ'), SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.confusedWith).toBe('れ')
    expect(score.message).toContain('「れ」')
    expect(score.problemStrokes.length).toBeGreaterThan(0)
  })

  it('れ、わ、ね 三個互相寫錯都抓得到', () => {
    for (const [target, written] of [
      ['れ', 'わ'],
      ['わ', 'れ'],
      ['れ', 'ね'],
      ['わ', 'ね'],
      ['ぬ', 'め'],
      ['め', 'ぬ'],
      ['シ', 'ツ'],
      ['ツ', 'シ'],
      ['ソ', 'ン'],
      ['ン', 'ソ'],
    ]) {
      const score = scoreCharacter(target, trace(written), SIZE, PEN)
      expect(score.verdict, `${target} 寫成 ${written}`).not.toBe('ok')
    }
  })

  it('稍微歪掉但寫對的字不會被說成別的字', () => {
    const rand = seeded(42)
    const wrongly: string[] = []
    for (const ch of Object.keys(STROKE_PATHS)) {
      for (let r = 0; r < 5; r++) {
        const dx = rand() * 8
        const dy = rand() * 8
        const score = scoreCharacter(
          ch,
          trace(ch, (p, i) => ({ x: p.x + dx + Math.sin(i / 3) * 1.5, y: p.y + dy + Math.cos(i / 3) * 1.5 })),
          SIZE,
          PEN,
        )
        if (score.confusedWith && score.verdict === 'bad') wrongly.push(`${ch}→${score.confusedWith}`)
      }
    }
    expect(wrongly).toEqual([])
  })

  it('寫得比範本小、偏上的「ら」不會被說成「う」（使用者回報的實際筆跡）', () => {
    // iPad 截圖量出來的座標，畫布 665px
    const px = 665
    const ink = (pts: number[][]) => pts.map(([x, y]) => ({ x: x - 528, y: y - 338, pressure: 0.5 }))
    const user = [
      ink([[828, 510], [890, 543], [855, 560]]),
      ink([[812, 612], [812, 697], [860, 665], [905, 655], [945, 690], [940, 740], [900, 780], [860, 790], [808, 778]]),
    ]
    for (const t of [PEN, FINGER]) {
      const score = scoreCharacter('ら', user, px, t)
      expect(score.confusedWith).toBeUndefined()
      expect(score.verdict).not.toBe('bad')
    }
  })

  it('整個字縮小、平移之後，相似字還是照形狀判：寫成 う 抓得到，寫對的 ら 不冤枉', () => {
    const small = (p: Point) => ({ x: 30 + p.x * 0.6, y: 20 + p.y * 0.6 })
    expect(scoreCharacter('ら', trace('う', small), SIZE, FINGER).confusedWith).toBe('う')
    expect(scoreCharacter('ら', trace('ら', small), SIZE, FINGER).confusedWith).toBeUndefined()
    expect(scoreCharacter('ね', trace('れ', small), SIZE, FINGER).confusedWith).toBe('れ')
  })

  it('「わ」收尾沒有往內收（直直往下）：不給 ◎，指出第 2 筆的收尾（使用者回報的實際筆跡）', () => {
    const px = 665
    const ink = (pts: number[][]) => pts.map(([x, y]) => ({ x: x - 528, y: y - 345, pressure: 0.5 }))
    const user = [
      ink([[727, 530], [722, 620], [724, 700], [732, 820]]),
      ink([[660, 608], [780, 578], [670, 718], [760, 672], [860, 632], [940, 622], [990, 640], [1020, 680], [1012, 750], [1015, 830], [1022, 895]]),
    ]
    for (const t of [PEN, FINGER]) {
      const score = scoreCharacter('わ', user, px, t)
      expect(score.verdict).toBe('shape')
      expect(score.message).toContain('第 2 筆的收尾方向不對')
      expect(score.problemStrokes).toContain(2)
    }
  })

  it('收尾往外勾的「わ」說像「れ」；收尾對的「れ」「わ」照樣 ◎', () => {
    const score = scoreCharacter('わ', trace('れ'), SIZE, PEN)
    expect(score.verdict).not.toBe('ok')
    expect(score.confusedWith).toBe('れ')
    expect(scoreCharacter('わ', trace('わ'), SIZE, PEN).verdict).toBe('ok')
    expect(scoreCharacter('れ', trace('れ'), SIZE, PEN).verdict).toBe('ok')
  })

  it('寫對但手抖、歪一點的字，不會因為收尾方向被冤枉', () => {
    const rand = seeded(7)
    const wrongly: string[] = []
    for (const ch of Object.keys(STROKE_PATHS)) {
      for (let r = 0; r < 5; r++) {
        const dx = rand() * 8
        const dy = rand() * 8
        const score = scoreCharacter(
          ch,
          trace(ch, (p, i) => ({ x: p.x + dx + rand() * 3, y: p.y + dy + Math.sin(i / 3) * 1.5 + rand() * 3 })),
          SIZE,
          PEN,
        )
        if (score.message.includes('收尾')) wrongly.push(ch)
      }
    }
    expect(wrongly).toEqual([])
  })

  it('小字不跟自己的大字比（ゃ／や 是同一個字）', () => {
    const score = scoreCharacter('ゃ', trace('や'), SIZE, PEN)
    expect(score.confusedWith).not.toBe('や')
  })

  it('平假名不跟片假名比（へ／ヘ 長得一樣）', () => {
    const score = scoreCharacter('へ', trace('ヘ'), SIZE, PEN)
    expect(score.confusedWith).toBeUndefined()
  })
})

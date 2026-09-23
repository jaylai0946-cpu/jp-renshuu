import { distance, resample, type InkPoint, type Point } from './path'
import { SAMPLES_PER_STROKE, templateFor, toKanjiVGSpace } from './strokes'
import { thresholdsFor, type Thresholds } from './thresholds'

export type Verdict = 'ok' | 'shape' | 'bad'

export interface StrokeScore {
  verdict: Verdict
  /** 起筆點離範本多遠（KanjiVG 座標） */
  startDistance: number
  /** 逐點平均距離 */
  shapeDistance: number
  /** 這一筆是不是從另一端起筆（方向寫反） */
  reversed: boolean
}

export interface Score {
  verdict: Verdict
  /** 對齊使用者實際寫的筆數，畫布要用它上色 */
  strokes: StrokeScore[]
  expected: number
  actual: number
  /** 給人看的一句話 */
  message: string
  /** 第幾筆有問題（1 起算）。筆數就錯的話是空的 */
  problemStrokes: number[]
}

/**
 * 判分。全部在本機算，不呼叫 AI。
 *
 * 作法照 SPEC：
 *   1. 使用者的筆畫和範本都放到 KanjiVG 的 109×109
 *   2. 兩邊各重新取樣成同樣點數（等距，所以寫快寫慢不影響）
 *   3. 逐筆比對筆數、起筆位置、形狀
 *
 * 用「逐點平均距離」而不是 DTW：等距重新取樣之後，速度差異已經被消掉了，
 * DTW 剩下的彈性反而會把「形狀對但位置偏」也算成對——而位置正是田字格
 * 要教的東西。
 *
 * 筆順錯會自然被抓到：第 i 筆一律跟範本第 i 筆比，順序顛倒的話兩者差很遠。
 */
export function scoreCharacter(
  ch: string,
  userStrokes: InkPoint[][],
  canvasSize: number,
  thresholds: Thresholds,
): Score {
  const template = templateFor(ch)
  const expected = template.length
  const actual = userStrokes.length

  if (!expected) {
    return { verdict: 'bad', strokes: [], expected: 0, actual, message: '這個字沒有筆順資料', problemStrokes: [] }
  }

  if (actual !== expected) {
    return {
      verdict: 'bad',
      strokes: userStrokes.map(() => ({ verdict: 'bad' as const, startDistance: 0, shapeDistance: 0, reversed: false })),
      expected,
      actual,
      message: `筆畫數不對：這個字是 ${expected} 筆，你寫了 ${actual} 筆`,
      problemStrokes: [],
    }
  }

  const strokes = userStrokes.map((raw, i) =>
    scoreStroke(resample(toKanjiVGSpace(raw, canvasSize), SAMPLES_PER_STROKE), template[i], thresholds),
  )

  const problemStrokes = strokes
    .map((s, i) => (s.verdict === 'ok' ? 0 : i + 1))
    .filter((n) => n > 0)

  const bad = strokes.findIndex((s) => s.verdict === 'bad')
  if (bad >= 0) {
    const s = strokes[bad]
    return {
      verdict: 'bad',
      strokes,
      expected,
      actual,
      message: s.reversed
        ? `第 ${bad + 1} 筆的方向反了，要從另一端起筆`
        : `第 ${bad + 1} 筆的起筆位置差太多，筆順可能不對`,
      problemStrokes,
    }
  }

  if (problemStrokes.length) {
    return {
      verdict: 'shape',
      strokes,
      expected,
      actual,
      message: `筆順對了，第 ${problemStrokes.join('、')} 筆的形狀再修一下`,
      problemStrokes,
    }
  }

  return { verdict: 'ok', strokes, expected, actual, message: '筆順和字形都對', problemStrokes }
}

function scoreStroke(user: Point[], template: Point[], t: Thresholds): StrokeScore {
  const startDistance = distance(user[0], template[0])

  /*
   * 方向寫反要兩端一起看，不能只看起點。
   *
   * 只比起點的話，筆順顛倒（第 3 筆寫成第 1 筆）常常會被誤判成「方向反了」：
   * 那一筆的起點碰巧離範本第 1 筆的終點比較近。真的寫反的筆是起點對到範本
   * 的終點「而且」終點對到範本的起點，兩邊都要吻合才算。
   */
  const last = template.length - 1
  const forward = startDistance + distance(user[last], template[last])
  const backward = distance(user[0], template[last]) + distance(user[last], template[0])
  const reversed = backward < forward && backward <= t.startMax * 2

  let sum = 0
  for (let i = 0; i < template.length; i++) sum += distance(user[i], template[i])
  const shapeDistance = sum / template.length

  if (reversed || startDistance > t.startMax) {
    return { verdict: 'bad', startDistance, shapeDistance, reversed }
  }
  if (shapeDistance > t.shapeMax) {
    return { verdict: 'shape', startDistance, shapeDistance, reversed }
  }
  return { verdict: 'ok', startDistance, shapeDistance, reversed }
}

/**
 * 只判一筆。描寫模式要「寫錯一筆當場變紅」，不能等整個字寫完。
 * index 超出範本筆數（寫太多筆）一律算錯。
 */
export function scoreSingleStroke(
  ch: string,
  stroke: InkPoint[],
  index: number,
  canvasSize: number,
  thresholds: Thresholds,
): Verdict {
  const template = templateFor(ch)
  if (index >= template.length) return 'bad'
  return scoreStroke(
    resample(toKanjiVGSpace(stroke, canvasSize), SAMPLES_PER_STROKE),
    template[index],
    thresholds,
  ).verdict
}

/** 多個字（拗音是兩格）的總評：取最差的那一格 */
export function combineVerdicts(verdicts: Verdict[]): Verdict {
  if (!verdicts.length) return 'bad'
  if (verdicts.includes('bad')) return 'bad'
  if (verdicts.includes('shape')) return 'shape'
  return 'ok'
}

/** 畫布用的包裝：門檻依「只用 Apple Pencil」的設定決定 */
export function scoreWith(
  ch: string,
  userStrokes: InkPoint[][],
  canvasSize: number,
  penOnly: boolean,
): Score {
  return scoreCharacter(ch, userStrokes, canvasSize, thresholdsFor(penOnly))
}

export const VERDICT_LABEL: Record<Verdict, { mark: string; text: string }> = {
  ok: { mark: '◎', text: '正確' },
  shape: { mark: '△', text: '形狀偏了' },
  bad: { mark: '✕', text: '筆順或筆畫數錯' },
}

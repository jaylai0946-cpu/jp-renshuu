import { distance, resample, type InkPoint, type Point } from './path'
import { SAMPLES_PER_STROKE, STROKE_PATHS, templateFor, toKanjiVGSpace } from './strokes'
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
  /** 寫得比較像哪個相似字（ね 寫成 れ 之類） */
  confusedWith?: string
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

  const normalized = userStrokes.map((raw) => resample(toKanjiVGSpace(raw, canvasSize), SAMPLES_PER_STROKE))
  const strokes = normalized.map((user, i) => scoreStroke(user, template[i], thresholds))

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

  // 筆順都對了，再看是不是其實寫成了另一個相似的字
  const confused = closestConfusable(ch, normalized, strokes)
  if (confused && confused.margin > thresholds.confuseStrong) {
    // 跟那個字比較像的筆標紅，畫布上看得出差在哪
    const marked = strokes.map((s, i) =>
      confused.perStroke[i] + 1 < s.shapeDistance ? { ...s, verdict: 'bad' as const } : s,
    )
    const flagged = marked.map((s, i) => (s.verdict === 'bad' ? i + 1 : 0)).filter((n) => n > 0)
    return {
      verdict: 'bad',
      strokes: flagged.length ? marked : strokes.map((s) => ({ ...s, verdict: 'bad' as const })),
      expected,
      actual,
      message: `這樣寫比較像「${confused.ch}」，不是「${ch}」`,
      problemStrokes: flagged.length ? flagged : strokes.map((_, i) => i + 1),
      confusedWith: confused.ch,
    }
  }
  const lookalike = confused && confused.margin > thresholds.confuseWeak ? confused.ch : undefined

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

  if (lookalike) {
    return {
      verdict: 'shape',
      strokes,
      expected,
      actual,
      message: `有點像「${lookalike}」，跟「${ch}」的範本對照一下`,
      problemStrokes,
      confusedWith: lookalike,
    }
  }

  return { verdict: 'ok', strokes, expected, actual, message: '筆順和字形都對', problemStrokes }
}

// ---- 相似字 ----

const SMALL_TO_LARGE: Record<string, string> = {
  ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ',
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ',
}
const base = (ch: string) => SMALL_TO_LARGE[ch] ?? ch
const isHiragana = (ch: string) => /[\u3041-\u3096]/.test(ch)

const candidateCache = new Map<string, string[]>()

/**
 * 可能被寫混的字：同一種假名（平假名不跟片假名比，へ／ヘ 本來就長一樣）、
 * 同樣筆數（筆數不同早就被「筆畫數不對」擋掉了）、不是自己的大小寫（ゃ／や）。
 */
function confusablesOf(ch: string): string[] {
  const cached = candidateCache.get(ch)
  if (cached) return cached
  const n = templateFor(ch).length
  const list = Object.keys(STROKE_PATHS).filter(
    (c) => base(c) !== base(ch) && isHiragana(c) === isHiragana(ch) && templateFor(c).length === n,
  )
  candidateCache.set(ch, list)
  return list
}

function meanDistance(a: Point[], b: Point[]): number {
  let sum = 0
  for (let i = 0; i < b.length; i++) sum += distance(a[i], b[i])
  return sum / b.length
}

/**
 * 寫出來的東西最像哪個相似字，比目標近了多少（KanjiVG 座標的平均距離）。
 * 沒有比目標更像的就回 null。
 */
function closestConfusable(
  ch: string,
  user: Point[][],
  own: StrokeScore[],
): { ch: string; margin: number; perStroke: number[] } | null {
  const target = own.reduce((n, s) => n + s.shapeDistance, 0) / own.length
  let best: { ch: string; margin: number; perStroke: number[] } | null = null
  for (const c of confusablesOf(ch)) {
    const perStroke = templateFor(c).map((t, i) => meanDistance(user[i], t))
    const d = perStroke.reduce((n, x) => n + x, 0) / perStroke.length
    const margin = target - d
    if (margin > 0 && (!best || margin > best.margin)) best = { ch: c, margin, perStroke }
  }
  return best
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
  bad: { mark: '✕', text: '寫錯了' },
}

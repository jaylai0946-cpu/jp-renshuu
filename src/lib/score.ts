import { distance, polylineLength, resample, type InkPoint, type Point } from './path'
import { KANJIVG_SIZE, SAMPLES_PER_STROKE, STROKE_PATHS, templateFor, toKanjiVGSpace } from './strokes'
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

  // 收尾決定是哪個字的筆，收尾方向要對
  const ends = endProblems(ch, normalized, thresholds.endTurn)
  if (ends.length) {
    const marked = strokes.map((s, i) => (ends.some((e) => e.stroke === i) ? { ...s, verdict: 'shape' as const } : s))
    const first = ends[0]
    return {
      verdict: 'shape',
      strokes: marked,
      expected,
      actual,
      message: `第 ${first.stroke + 1} 筆的收尾方向不對${first.like ? `，這樣收會像「${first.like}」` : ''}`,
      problemStrokes: [...new Set([...problemStrokes, ...ends.map((e) => e.stroke + 1)])].sort((a, b) => a - b),
      ...(first.like ? { confusedWith: first.like } : {}),
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
 * 整個字縮放、平移到同樣大小、置中（保持長寬比、各筆的相對位置）。
 *
 * 比相似字時用：寫得比範本小、或整個偏到一邊，絕對位置一比就可能剛好靠近
 * 另一個字的範本（小一號、偏上的「ら」離「う」的範本比較近）。對齊之後比的才是形狀。
 * 位置寫得好不好由逐筆的起筆、形狀判分負責，不在這裡管。
 */
const NORMAL_SIZE = 80
const normalCache = new Map<string, Point[][]>()

export function normalizeChar(strokes: Point[][]): Point[][] {
  const all = strokes.flat()
  if (!all.length) return strokes
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = NORMAL_SIZE / Math.max(maxX - minX, maxY - minY, 1)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const half = KANJIVG_SIZE / 2
  return strokes.map((st) => st.map((p) => ({ x: half + (p.x - cx) * k, y: half + (p.y - cy) * k })))
}

function normalTemplate(ch: string): Point[][] {
  let t = normalCache.get(ch)
  if (!t) normalCache.set(ch, (t = normalizeChar(templateFor(ch))))
  return t
}

/**
 * 寫出來的東西最像哪個相似字，比目標近了多少（大小、位置對齊之後的平均距離）。
 * 沒有比目標更像的就回 null。perStroke 是跟那個字逐筆的距離（原座標），畫布標紅用。
 */
function closestConfusable(
  ch: string,
  user: Point[][],
  own: StrokeScore[],
): { ch: string; margin: number; perStroke: number[] } | null {
  const shape = normalizeChar(user)
  const avg = (t: Point[][]) => t.reduce((n, ts, i) => n + meanDistance(shape[i], ts), 0) / t.length
  const target = avg(normalTemplate(ch))
  let best: { ch: string; margin: number; perStroke: number[] } | null = null
  for (const c of confusablesOf(ch)) {
    const margin = target - avg(normalTemplate(c))
    if (margin > 0 && (!best || margin > best.margin)) {
      best = { ch: c, margin, perStroke: templateFor(c).map((t, i) => meanDistance(user[i], t)) }
    }
  }
  // own 只用來對齊筆數；逐筆分數已經在 scoreStroke 算過
  return own.length === user.length ? best : null
}

// ---- 收尾方向 ----

/** 一筆最後一小段（約 15%）往哪個方向走，角度（度） */
function endAngle(stroke: Point[]): number {
  const a = stroke[Math.max(0, stroke.length - 6)]
  const b = stroke[stroke.length - 1]
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 兩個字的範本形狀差多少（對齊大小後），低於這個才算長得像 */
const LOOKALIKE_MAX = 16
/** 收尾可以偏到和相似字之間角度的幾成 */
const END_GAP_SHARE = 0.4
/** 這麼長以上的筆才看收尾方向（KanjiVG 座標） */
const MIN_KEY_LENGTH = 40

interface KeyEnd {
  stroke: number
  angle: number
  /** 收尾往別的方向就會變成的字，和那個字這一筆的收尾角度 */
  others: { ch: string; angle: number }[]
}
const keyEndCache = new Map<string, KeyEnd[]>()

/**
 * 哪幾筆的收尾是「跟長得像的字分辨」的關鍵：
 * 同筆數、整體形狀很像（わ／れ），但這一筆收尾方向差 90° 以上。
 */
function keyEnds(ch: string): KeyEnd[] {
  const cached = keyEndCache.get(ch)
  if (cached) return cached
  const own = templateFor(ch)
  const ownN = normalTemplate(ch)
  const byStroke = new Map<number, KeyEnd>()
  for (const c of confusablesOf(ch)) {
    const other = templateFor(c)
    const otherN = normalTemplate(c)
    const d = ownN.reduce((n, ts, i) => n + meanDistance(otherN[i], ts), 0) / ownN.length
    if (d > LOOKALIKE_MAX) continue
    own.forEach((ts, i) => {
      // 短短一點的筆（ら、ち 的第 1 筆）收尾方向抖一下就變，看不出來
      if (polylineLength(ts) < MIN_KEY_LENGTH) return
      const mine = endAngle(ts)
      const theirs = endAngle(other[i])
      if (angleDiff(mine, theirs) <= 90) return
      const entry = byStroke.get(i) ?? { stroke: i, angle: mine, others: [] }
      entry.others.push({ ch: c, angle: theirs })
      byStroke.set(i, entry)
    })
  }
  const list = [...byStroke.values()].sort((a, b) => a.stroke - b.stroke)
  keyEndCache.set(ch, list)
  return list
}

/** 關鍵筆的收尾方向偏太多的筆，順便找出這樣收比較像哪個字 */
function endProblems(ch: string, user: Point[][], tolerance: number): { stroke: number; like?: string }[] {
  const out: { stroke: number; like?: string }[] = []
  for (const k of keyEnds(ch)) {
    const got = endAngle(user[k.stroke])
    const off = angleDiff(got, k.angle)
    // 跟最像的字收尾只差一百多度的（わ 143° vs れ 26°），中間那段（直直往下）兩邊都不算對
    const gap = Math.min(...k.others.map((o) => angleDiff(k.angle, o.angle)))
    if (off <= Math.min(tolerance, gap * END_GAP_SHARE)) continue
    const nearest = k.others.reduce((a, b) => (angleDiff(got, b.angle) < angleDiff(got, a.angle) ? b : a))
    out.push({ stroke: k.stroke, like: angleDiff(got, nearest.angle) < off ? nearest.ch : undefined })
  }
  return out
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

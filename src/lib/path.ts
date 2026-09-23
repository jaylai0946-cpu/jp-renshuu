export interface Point {
  x: number
  y: number
}

/** 使用者寫出來的點。pressure 只有 Apple Pencil 這類裝置會給 */
export interface InkPoint extends Point {
  pressure: number
}

/**
 * SVG path 轉成折線。
 *
 * 只支援 M 和 c——KanjiVG 的假名只用到這兩個指令，build-kanjivg.mjs 會檢查，
 * 冒出別的會直接讓建置失敗。刻意不用瀏覽器的 getPointAtLength()：
 * 那個要有 DOM，判分邏輯就沒辦法在 Node 裡單獨測。
 *
 * @param perCurve 每段貝茲曲線切幾段。8 段對 109×109 的字已經看不出折角
 */
export function flattenPath(d: string, perCurve = 8): Point[] {
  // 指令字母全部收進來（不只支援的那幾個），不然沒支援的指令會被 tokenizer
  // 吞掉，錯誤訊息指到後面的數字，看不出是哪個指令有問題。
  // 1e-5 這種科學記號不會被拆錯：數字那一條會整串吃掉，輪不到 [A-Za-z]
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return []

  const out: Point[] = []
  let cursor: Point = { x: 0, y: 0 }
  let i = 0

  function num(): number {
    const v = Number(tokens![i++])
    if (!Number.isFinite(v)) throw new Error(`path 裡有讀不懂的數字：${tokens![i - 1]}`)
    return v
  }

  while (i < tokens.length) {
    const token = tokens[i]

    if (token === 'M') {
      i++
      cursor = { x: num(), y: num() }
      out.push(cursor)
      continue
    }

    if (token === 'c') {
      i++
      // 一個 c 後面可以接好幾組座標，直到下一個指令字母
      while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
        const c1 = { x: cursor.x + num(), y: cursor.y + num() }
        const c2 = { x: cursor.x + num(), y: cursor.y + num() }
        const end = { x: cursor.x + num(), y: cursor.y + num() }
        for (let s = 1; s <= perCurve; s++) {
          out.push(cubicAt(cursor, c1, c2, end, s / perCurve))
        }
        cursor = end
      }
      continue
    }

    throw new Error(`path 指令 ${token} 還沒支援`)
  }

  return out
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const e = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
  }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function polylineLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

/**
 * 重新取樣成 n 個等距的點。
 *
 * 判分要比較「形狀」，兩筆的點數和疏密必須一致才比得下去——使用者寫快寫慢
 * 產生的點數差很多，直接逐點比會變成在比書寫速度。
 */
export function resample(points: Point[], n: number): Point[] {
  if (n < 2) throw new Error('至少要取樣 2 個點')
  if (!points.length) return []
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }))

  const total = polylineLength(points)
  // 整筆長度是 0（原地點一下）就全部塞同一個點，不要除以零
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0] }))

  const step = total / (n - 1)
  const out: Point[] = [{ ...points[0] }]
  let segment = 1
  let walked = 0

  for (let k = 1; k < n - 1; k++) {
    const target = k * step
    while (segment < points.length - 1 && walked + distance(points[segment - 1], points[segment]) < target) {
      walked += distance(points[segment - 1], points[segment])
      segment++
    }
    const a = points[segment - 1]
    const b = points[segment]
    const len = distance(a, b)
    const t = len === 0 ? 0 : (target - walked) / len
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }

  out.push({ ...points[points.length - 1] })
  return out
}

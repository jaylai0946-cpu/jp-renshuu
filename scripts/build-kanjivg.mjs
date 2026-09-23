/**
 * 把 KanjiVG 的筆順資料轉成 App 用的 src/data/strokes.json。
 *
 * KanjiVG（https://kanjivg.tagaini.net/）授權 CC BY-SA 3.0，作者 Ulrich Apel。
 * App 的「關於」頁有標示出處，改作的這份資料也適用同一授權。
 *
 * 只抓 App 用得到的假名，不整包放進來。產出物 commit 進 repo，
 * 這樣 CI 不必連外網——KanjiVG 掛掉不該讓部署跟著失敗。
 *
 * 跑法：node scripts/build-kanjivg.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'src', 'data', 'strokes.json')
const BASE = 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji'

// 跟 src/data/units.ts 同一份清單。有測試盯著兩邊一致（strokes.test.ts）
const SEION = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
const DAKU = 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'
const SMALL = 'ゃゅょ'

function toKata(s) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

const HIRA = [...(SEION + DAKU + SMALL)]
const CHARS = [...HIRA, ...HIRA.map(toKata)]

/** KanjiVG 的檔名是 5 位小寫十六進位的 Unicode 碼，例如 あ -> 03042.svg */
function fileFor(ch) {
  return ch.codePointAt(0).toString(16).padStart(5, '0') + '.svg'
}

/**
 * 只取 StrokePaths 那一段的 <path>，而且要照 -sN 的編號排序。
 * StrokeNumbers 那段是筆順編號的文字，不是筆畫，不能混進來。
 */
function extractStrokes(svg, ch) {
  const start = svg.indexOf('kvg:StrokePaths_')
  if (start < 0) throw new Error(`${ch}: 找不到 StrokePaths`)
  const end = svg.indexOf('kvg:StrokeNumbers_')
  const body = svg.slice(start, end < 0 ? undefined : end)

  const found = []
  const re = /<path[^>]*\bid="kvg:[0-9a-f]+-s(\d+)"[^>]*\bd="([^"]+)"/g
  let m
  while ((m = re.exec(body))) found.push({ n: Number(m[1]), d: m[2].trim() })

  if (!found.length) throw new Error(`${ch}: 一筆都沒抓到`)
  found.sort((a, b) => a.n - b.n)

  // 編號要是連續的 1..N，缺號代表解析出錯，寧可爆掉也不要出一份壞資料
  found.forEach((s, i) => {
    if (s.n !== i + 1) throw new Error(`${ch}: 筆順編號不連續，第 ${i + 1} 筆是 s${s.n}`)
  })
  return found.map((s) => s.d)
}

/** 只支援這些指令。KanjiVG 用不到的東西跑出來要立刻知道，不要默默畫錯 */
const ALLOWED = /^[MmCcSsLlZz\s\d.,\-+eE]+$/

async function main() {
  const strokes = {}
  const commands = new Set()
  let failed = 0

  for (const ch of CHARS) {
    const url = `${BASE}/${fileFor(ch)}`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const paths = extractStrokes(await res.text(), ch)

      for (const d of paths) {
        if (!ALLOWED.test(d)) throw new Error(`${ch}: path 有沒支援的指令：${d.slice(0, 60)}`)
        for (const c of d.match(/[A-Za-z]/g) ?? []) commands.add(c)
      }
      strokes[ch] = paths
      process.stdout.write(`${ch}${paths.length} `)
    } catch (e) {
      failed++
      console.error(`\n✗ ${ch} (${fileFor(ch)}): ${e.message}`)
    }
  }

  console.log(`\n\n用到的 path 指令：${[...commands].sort().join(' ')}`)
  if (failed) throw new Error(`有 ${failed} 個字抓不到，沒有寫出檔案`)

  mkdirSync(dirname(OUT), { recursive: true })
  // 不排版，這是產出物不是給人讀的；key 照 CHARS 的順序
  writeFileSync(OUT, JSON.stringify(strokes) + '\n')

  const total = Object.values(strokes).reduce((n, p) => n + p.length, 0)
  const kb = (Buffer.byteLength(JSON.stringify(strokes)) / 1024).toFixed(1)
  console.log(`${Object.keys(strokes).length} 個字、${total} 筆，${kb} KB -> ${OUT}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})

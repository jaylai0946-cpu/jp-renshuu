/**
 * 產生 PWA 圖示。這台機器沒有 ImageMagick 之類的工具，所以自己寫一個
 * 最小的 PNG 編碼器（Node 內建 zlib 就夠）。跑 `node scripts/make-icons.mjs` 重新產生。
 *
 * 圖案：和紙色底、紅色印章方框、中間一個「日」——「日」只有直橫線，
 * 不需要字型就畫得出來，在主畫面上縮到 60px 也還看得懂。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'public')

const PAPER = [0xee, 0xf3, 0xef]
const STAMP = [0xc4, 0x37, 0x2c]

// ---- PNG 編碼 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** pixels 是 RGB（不含 alpha），長度 = size * size * 3 */
function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  // 10-12: compression / filter / interlace 都是 0

  // 每條掃描線前面要加一個 filter byte
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const at = y * (size * 3 + 1)
    raw[at] = 0
    pixels.copy(raw, at + 1, y * size * 3, (y + 1) * size * 3)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 畫圖 ----
/** 圓角矩形：回傳一個判斷某點在不在裡面的函式 */
function roundRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
    const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
    if (cx === x || cy === y) return true
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
}

function rect(x0, y0, x1, y1) {
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
}

/**
 * @param size 邊長
 * @param inset 印章方框距離邊緣的比例。maskable 要留安全區，所以縮得比較多
 */
function draw(size, inset) {
  const px = Buffer.alloc(size * size * 3)
  const pad = Math.round(size * inset)
  const t = Math.max(2, Math.round(size * 0.055)) // 線的粗細
  const r = Math.round(size * 0.12)

  const outer = roundRect(pad, pad, size - 1 - pad, size - 1 - pad, r)
  const inner = roundRect(pad + t, pad + t, size - 1 - pad - t, size - 1 - pad - t, Math.max(0, r - t))

  // 「日」：外框 + 中間一橫。寬度比高度窄，看起來才像字不像窗戶
  const gx0 = Math.round(size * 0.5 - size * 0.155)
  const gx1 = Math.round(size * 0.5 + size * 0.155)
  const gy0 = Math.round(size * 0.5 - size * 0.215)
  const gy1 = Math.round(size * 0.5 + size * 0.215)
  const gOuter = rect(gx0, gy0, gx1, gy1)
  const gInner = rect(gx0 + t, gy0 + t, gx1 - t, gy1 - t)
  const gBar = rect(gx0, Math.round((gy0 + gy1) / 2 - t / 2), gx1, Math.round((gy0 + gy1) / 2 + t / 2))

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const frame = outer(x, y) && !inner(x, y)
      const glyph = (gOuter(x, y) && !gInner(x, y)) || gBar(x, y)
      const c = frame || glyph ? STAMP : PAPER
      const at = (y * size + x) * 3
      px[at] = c[0]
      px[at + 1] = c[1]
      px[at + 2] = c[2]
    }
  }
  return encodePNG(size, px)
}

mkdirSync(OUT, { recursive: true })

const files = [
  ['icon-192.png', draw(192, 0.08)],
  ['icon-512.png', draw(512, 0.08)],
  // maskable 會被裁成圓形，內容要留在中間 80% 裡
  ['icon-maskable-512.png', draw(512, 0.19)],
  ['apple-touch-icon.png', draw(180, 0.08)],
]

for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf)
  console.log(`${name}  ${buf.length} bytes`)
}

// favicon 用 SVG，分頁上比點陣圖清楚
writeFileSync(
  join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="10" fill="#EEF3EF"/>
  <rect x="5.5" y="5.5" width="53" height="53" rx="8" fill="none" stroke="#C4372C" stroke-width="3.5"/>
  <rect x="22" y="18" width="20" height="28" fill="none" stroke="#C4372C" stroke-width="3.5"/>
  <line x1="22" y1="32" x2="42" y2="32" stroke="#C4372C" stroke-width="3.5"/>
</svg>
`,
)
console.log('favicon.svg')

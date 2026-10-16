import type { Song, SongLine, SongWord } from '../types'
import { urlFor, type SyncConfig } from './sync'

/** 跟 Worker 的上限一致：不同的日文句子最多 100 句、日文最多 6000 字、中文最多 8000 字 */
export const SONG_MAX_LINES = 100
export const SONG_MAX_CHARS = 6000
export const SONG_MAX_ZH_CHARS = 8000

const KANA = /[\u3041-\u3096\u30a1-\u30fa]/
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/
const LATIN_LETTER = /[A-Za-z\u00c0-\u017f]/
/** 日文幾乎不會用、中文歌詞很常見的字（繁簡都放） */
const CHINESE_ONLY = /[的了們们這这嗎吗麼么著着沒没說说會你妳她吧呢啊哦讓让給给從从为对个]/

type Row = 'jp' | 'kana' | 'latin' | 'han' | 'zh' | 'none'

function rowKind(line: string): Row {
  const kana = KANA.test(line)
  const han = HAN.test(line)
  if (kana) return han ? 'jp' : 'kana'
  if (han) return CHINESE_ONLY.test(line) ? 'zh' : 'han'
  // 沒有假名、漢字：有拉丁字母就是羅馬拼音或英文（全形的？！也算，標點不影響）
  return LATIN_LETTER.test(line) ? 'latin' : 'none'
}

/** 只留假名，片假名換成平假名，拿掉長音和標點，用來比讀音 */
function kanaOf(line: string): string {
  return [...line]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c
    })
    .filter((c) => /[\u3041-\u3096]/.test(c))
    .join('')
}

/**
 * reading 是不是 original 的平假名讀音（歌詞網站常在日文下面附一行）。
 * 原文裡的假名照順序都會出現在讀音裡、讀音比較長；原文沒有漢字的話兩行要一樣。
 */
function isReadingOf(original: string, reading: string): boolean {
  const src = kanaOf(original)
  const read = kanaOf(reading)
  if (!read) return false
  if (!HAN.test(original)) return src === read
  // 每個漢字至少讀一個假名、最多五個左右；差太多就不是這行的讀音
  const kanji = [...original].filter((c) => HAN.test(c)).length
  if (read.length < src.length + kanji || read.length > src.length + kanji * 5) return false
  let i = 0
  for (const c of read) if (c === src[i]) i++
  return i === src.length
}

/**
 * 從歌詞網站複製時常常是一組一組交錯：
 *
 *   日文（漢字假名混寫）
 *   平假名讀音（可能沒有）
 *   羅馬拼音（可能沒有）
 *   中文翻譯（可能沒有）
 *
 * 日文行拿去分析，中文行當翻譯參考，讀音和羅馬拼音丟掉（分析時會重新標）。
 *
 * - 有漢字又有假名的是日文
 * - 只有假名的：緊接在日文後面、而且是那行的讀音，就是讀音；不然是日文歌詞（そうなんだ）
 * - 只有拉丁字母的（全形？！也算）：大部分日文行後面都跟著一行的話是那首歌附的羅馬拼音，
 *   不然當成歌詞本身的英文
 * - 沒假名、有中文才有的字（的、了、們…）是中文
 * - 只有漢字、看不出來的（「月光」「無論如何」）看位置：後面跟著讀音或羅馬拼音的是日文；
 *   整首是交錯貼的話，緊接在日文、讀音、羅馬拼音後面的是中文翻譯；其他當日文
 */
export function splitLyrics(text: string): { jp: string; zh: string; zhLines: number; roLines: number } {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => rowKind(l) !== 'none')
  const kinds = rows.map(rowKind)
  const japanese = (k: Row) => k === 'jp' || k === 'kana' || k === 'han'

  // 羅馬拼音模式：日文行後面（中間可能隔一行讀音）大多跟著拉丁字母行
  const readingAfter = (i: number) => kinds[i + 1] === 'kana' && isReadingOf(rows[i], rows[i + 1])
  let followed = 0
  let jpCount = 0
  for (let i = 0; i < rows.length; i++) {
    if (!japanese(kinds[i])) continue
    jpCount++
    const reading = readingAfter(i)
    if (kinds[i + (reading ? 2 : 1)] === 'latin') followed++
    if (reading) i++ // 讀音那行不算一句
  }
  const romajiMode = followed >= 2 && followed >= jpCount * 0.4
  const zhCount = kinds.filter((k) => k === 'zh').length
  // 讀音行不算；只有漢字的行可能是日文也可能是中文，先都算日文，門檻放低一點
  const zhMode = zhCount >= 2 && zhCount >= jpCount * 0.25

  const jp: string[] = []
  const zh: string[] = []
  let roLines = 0
  let prev: 'jp' | 'read' | 'ro' | 'zh' | null = null
  let prevJp = ''
  rows.forEach((line, i) => {
    const k = kinds[i]
    let kind: 'jp' | 'read' | 'ro' | 'zh'
    if (k === 'jp') kind = 'jp'
    else if (k === 'zh') kind = 'zh'
    else if (k === 'kana') kind = prev === 'jp' && isReadingOf(prevJp, line) ? 'read' : 'jp'
    else if (k === 'latin') kind = romajiMode && (prev === 'jp' || prev === 'read') ? 'ro' : 'jp'
    else if (readingAfter(i)) kind = 'jp'
    else if (romajiMode && kinds[i + 1] === 'latin') kind = 'jp'
    else kind = zhMode && (prev === 'jp' || prev === 'read' || prev === 'ro') ? 'zh' : 'jp'

    if (kind === 'jp') {
      jp.push(line)
      prevJp = line
    } else if (kind === 'zh') zh.push(line)
    else roLines++
    prev = kind
  })
  return { jp: jp.join('\n'), zh: zh.join('\n'), zhLines: zh.length, roLines }
}

/** 不同的句子有幾句（重複的副歌只算一次，跟 Worker 算法一樣） */
export function uniqueLineCount(lyrics: string): number {
  return new Set(
    lyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  ).size
}

/**
 * 從 YouTube 網址抓影片 id。接受 watch?v=、youtu.be/、shorts/、embed/，
 * 也接受直接貼 id。認不出來就回空字串。
 */
export function parseYouTubeId(input: string): string {
  const text = input.trim()
  if (!text) return ''
  if (/^[\w-]{11}$/.test(text)) return text
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return ''
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id = ''
  if (host === 'youtu.be') id = url.pathname.slice(1)
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? ''
  }
  return /^[\w-]{11}$/.test(id) ? id : ''
}

export function newSongId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return 'song-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function wordKey(w: SongWord): string {
  return `${w.s}|${w.k}`
}

/** 有分析到的句數（模型偶爾會漏回幾句，那幾句就只有原文） */
export function analysedCount(lines: SongLine[]): number {
  return lines.filter((l) => l.kana || l.zh || l.words.length).length
}

/** 歌詞切成一段一段：標過的詞帶著 word，其他的字一個一個放（排版時才能在任何地方換行） */
export interface GlossSeg {
  text: string
  word?: SongWord
}

/**
 * 把一句歌詞依分析出來的詞切開，用來在每個詞底下標中文。
 *
 * 模型給的詞不一定照順序、也可能重複或對不上原文，所以一個一個去原文找
 * 還沒被佔走的位置，找不到的就不標（底下的單字卡還是看得到）。
 */
export function glossSegments(jp: string, words: SongWord[]): GlossSeg[] {
  const taken: { start: number; end: number; word: SongWord }[] = []
  for (const word of words) {
    if (!word.s) continue
    for (let from = 0; ; ) {
      const start = jp.indexOf(word.s, from)
      if (start < 0) break
      const end = start + word.s.length
      if (taken.every((t) => end <= t.start || start >= t.end)) {
        taken.push({ start, end, word })
        break
      }
      from = start + 1
    }
  }
  taken.sort((a, b) => a.start - b.start)

  const segs: GlossSeg[] = []
  let at = 0
  const plain = (to: number) => {
    for (const ch of jp.slice(at, to)) segs.push({ text: ch })
  }
  for (const t of taken) {
    plain(t.start)
    segs.push({ text: jp.slice(t.start, t.end), word: t.word })
    at = t.end
  }
  plain(jp.length)
  return segs
}

export type AnalyzeResponse =
  | { status: 'ok'; title: string; artist: string; lines: SongLine[] }
  | { status: 'error'; message: string }

function pickError(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return fallback
}

/** 送去 Worker 逐句分析。API key 只在 Worker 那邊 */
export async function analyzeSong(
  config: SyncConfig,
  /** zh：使用者自己貼的中文歌詞，有的話翻譯以這份為主 */
  input: { title: string; artist: string; lyrics: string; zh?: string },
): Promise<AnalyzeResponse> {
  let res: Response
  try {
    res = await fetch(urlFor(config, 'song'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    return { status: 'error', message: '連不上分析服務，檢查一下網路' }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // 有些錯誤不會回 JSON，下面用狀態碼給訊息
  }
  if (!res.ok) return { status: 'error', message: pickError(body, `分析失敗（${res.status}）`) }

  const song = (body as { song?: { title?: unknown; artist?: unknown; lines?: unknown } } | null)?.song
  if (!song || !Array.isArray(song.lines)) return { status: 'error', message: '分析結果讀不懂，再試一次' }
  return {
    status: 'ok',
    title: String(song.title ?? input.title),
    artist: String(song.artist ?? input.artist),
    // 形狀交給 validate 在存進 state 時再檢查一次
    lines: song.lines as SongLine[],
  }
}

// ---- 練習 ----

export type SongQuestion =
  | { kind: 'meaning'; word: SongWord; choices: string[]; answer: string }
  | { kind: 'blank'; word: SongWord; line: string; before: string; after: string; choices: string[]; answer: string }

type Rng = () => number

function shuffle<T>(xs: T[], rand: Rng): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 這首歌裡所有不重複的詞，連同第一次出現的那句 */
export function songWords(song: Song): { word: SongWord; line: SongLine }[] {
  const seen = new Set<string>()
  const out: { word: SongWord; line: SongLine }[] = []
  for (const line of song.lines) {
    for (const word of line.words) {
      const key = wordKey(word)
      if (seen.has(key) || !word.zh) continue
      seen.add(key)
      out.push({ word, line })
    }
  }
  return out
}

/** 至少要有幾個詞才出得了四選一 */
export const MIN_QUIZ_WORDS = 4

/**
 * 從這首歌的詞出一回題目，最多 10 題。
 *
 * 兩種題目輪流：看詞選意思、歌詞填空（把那個詞挖掉，從四個詞裡選）。
 * 還沒標成「會了」的詞優先；錯誤選項從同一首歌的其他詞拿，比較有鑑別度。
 */
export function buildSongQuiz(song: Song, rand: Rng = Math.random, size = 10): SongQuestion[] {
  const pool = songWords(song)
  const meanings = [...new Set(pool.map((p) => p.word.zh))]
  const surfaces = [...new Set(pool.map((p) => p.word.s))]
  if (pool.length < MIN_QUIZ_WORDS || meanings.length < MIN_QUIZ_WORDS) return []

  const known = new Set(song.known)
  const fresh = shuffle(pool.filter((p) => !known.has(wordKey(p.word))), rand)
  const rest = shuffle(pool.filter((p) => known.has(wordKey(p.word))), rand)
  const picked = [...fresh, ...rest].slice(0, size)

  return picked.map(({ word, line }, n): SongQuestion => {
    const at = line.jp.indexOf(word.s)
    const canBlank = at >= 0 && line.jp.indexOf(word.s, at + 1) < 0 && surfaces.length >= MIN_QUIZ_WORDS
    if (n % 2 === 1 && canBlank) {
      const others = shuffle(surfaces.filter((s) => s !== word.s), rand).slice(0, 3)
      return {
        kind: 'blank',
        word,
        line: line.jp,
        before: line.jp.slice(0, at),
        after: line.jp.slice(at + word.s.length),
        choices: shuffle([word.s, ...others], rand),
        answer: word.s,
      }
    }
    const others = shuffle(meanings.filter((m) => m !== word.zh), rand).slice(0, 3)
    return { kind: 'meaning', word, choices: shuffle([word.zh, ...others], rand), answer: word.zh }
  })
}

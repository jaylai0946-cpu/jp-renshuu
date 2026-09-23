import type { AppState } from '../types'
import { ymd } from './dates'
import { validateAppState } from './validate'

/**
 * 同步設定存在自己的 key，不放進 AppState。
 * 兩個原因：一是它是「這台裝置的設定」不是資料，二是匯出 JSON 備份時
 * 不能把密鑰一起吐出去。
 *
 * 跟課表 App 的密鑰也刻意分開存：兩個 App 各有各的 Worker 和 KV，
 * 密鑰互通會讓人以為資料相通。
 */
const SYNC_KEY = 'jp-renshuu.sync'

export interface SyncConfig {
  endpoint: string
  /** 32 字元隨機密鑰。這就是憑證，不要外流 */
  key: string
  /** 上次成功同步時，雲端的 updatedAt。用來做樂觀鎖 */
  lastSeen: string | null
  /** 這台裝置有還沒推上去的改動 */
  dirty: boolean
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 32 個小寫英數字。用 rejection sampling 避開 modulo 偏差。 */
export function generateKey(): string {
  const out: string[] = []
  const buf = new Uint8Array(48)
  while (out.length < 32) {
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (out.length >= 32) break
      // 252 = 36 * 7，超過的丟掉才不會讓前幾個字母機率偏高
      if (b < 252) out.push(ALPHABET[b % ALPHABET.length])
    }
  }
  return out.join('')
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.endpoint !== 'string' || typeof parsed?.key !== 'string') return null
    return {
      endpoint: parsed.endpoint,
      key: parsed.key,
      lastSeen: typeof parsed.lastSeen === 'string' ? parsed.lastSeen : null,
      dirty: parsed.dirty === true,
    }
  } catch {
    return null
  }
}

export function saveSyncConfig(config: SyncConfig | null): void {
  try {
    if (config) localStorage.setItem(SYNC_KEY, JSON.stringify(config))
    else localStorage.removeItem(SYNC_KEY)
  } catch {
    // 存不了就算了，同步只是輔助，不能因此讓 App 掛掉
  }
}

/**
 * 端點必須是 https，否則資料會用明文在網路上跑。localhost 例外，方便開發。
 *
 * 也擋掉「填成 App 自己的網址」——這是最容易犯的錯：GitHub Pages 只會發
 * 檔案，收到 PUT 會回 405，而「伺服器回 405」這種訊息看不出是填錯網址。
 */
export function validateEndpoint(endpoint: string, selfOrigin = currentOrigin()): string | null {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return '網址格式不對，要像 https://xxx.workers.dev'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !local) return '必須是 https 網址，不然資料會用明文傳送'
  if (selfOrigin && url.origin === selfOrigin) {
    return '這是這個 App 自己的網址，不是同步伺服器。要填 Cloudflare Worker 的 .workers.dev 網址'
  }
  return null
}

function currentOrigin(): string | null {
  try {
    return location.origin
  } catch {
    return null
  }
}

export function validateKey(key: string): string | null {
  return /^[a-z0-9]{32}$/.test(key) ? null : '密鑰必須是 32 個小寫英數字'
}

/**
 * 把同步設定包成一個連結，用 AirDrop 或訊息傳給**自己的另一台裝置**。
 *
 * 放在 # 後面而不是 query string，因為 hash 不會被送到伺服器，也不會留在
 * 任何 access log 裡。連結裡有密鑰，等同於憑證，只能傳給自己。
 */
export function buildSetupLink(config: SyncConfig, base = currentBase()): string {
  return `${base}#sync=${encodeURIComponent(config.endpoint)}|${config.key}`
}

/**
 * 邀請**別人**用的連結：只有伺服器網址，沒有密鑰。
 *
 * 對方打開之後會產生自己的一組密鑰，進度完全分開——KV 裡是兩筆不同的
 * state:<密鑰>。這個 App 沒有帳號系統，密鑰就是帳號。
 *
 * 分成兩顆按鈕是刻意的：把含密鑰的連結傳給別人，等於把自己的進度交出去，
 * 而且兩個人會開始互相覆蓋。
 */
export function buildInviteLink(endpoint: string, base = currentBase()): string {
  return `${base}#invite=${encodeURIComponent(endpoint)}`
}

function currentBase(): string {
  return location.href.split('#')[0]
}

export type SetupLink =
  /** 自己的另一台裝置：連上同一份進度 */
  | { kind: 'sync'; endpoint: string; key: string }
  /** 別人的邀請：用同一台伺服器，但要產生自己的密鑰 */
  | { kind: 'invite'; endpoint: string }

/**
 * 從網址的 hash 讀出設定。格式不對就回 null，不要讓亂貼的連結改到設定。
 */
export function parseSetupLink(hash: string): SetupLink | null {
  const raw = hash.replace(/^#/, '')

  if (raw.startsWith('invite=')) {
    const endpoint = decode(raw.slice('invite='.length))
    if (endpoint === null || validateEndpoint(endpoint)) return null
    return { kind: 'invite', endpoint: trimSlash(endpoint) }
  }

  if (!raw.startsWith('sync=')) return null

  const sep = raw.indexOf('|')
  if (sep < 0) return null

  const endpoint = decode(raw.slice('sync='.length, sep))
  const key = raw.slice(sep + 1).trim()
  if (endpoint === null || validateEndpoint(endpoint) || validateKey(key)) return null
  return { kind: 'sync', endpoint: trimSlash(endpoint), key }
}

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export function urlFor(config: SyncConfig, path = 's'): string {
  return `${config.endpoint.replace(/\/+$/, '')}/${path}/${config.key}`
}

/** 同步伺服器的錯誤碼翻成看得懂的話。 */
export function describeHttpError(status: number): string {
  if (status === 405 || status === 404) {
    return `這個網址不像同步伺服器（回 ${status}）。確認填的是 Cloudflare Worker 的 .workers.dev 網址`
  }
  if (status === 413) return '資料太大，伺服器不收'
  if (status >= 500) return `同步伺服器出錯（${status}），等一下再試`
  return `伺服器回 ${status}`
}

export interface RemoteRecord {
  updatedAt: string
  state: AppState
}

export type PullResult =
  | { status: 'empty' }
  | { status: 'ok'; record: RemoteRecord }
  | { status: 'error'; message: string }

/**
 * 雲端那份是不是別的 App 的？
 *
 * 課表 App（mcu-schedule）用同一套 Worker 協定，差別只在密鑰。這代表
 * 兩個 App 可以共用同一台 Worker——但也代表萬一兩邊填到同一組密鑰，
 * 不擋的話會發生：拉回來的資料驗不過 → 變成空白 → 再把空白推上去，
 * 把課表的進度洗掉。
 *
 * 所以認出不是自己的資料就直接報錯，讓 useSync 停在 error 不往下推。
 */
function foreignApp(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.courses)) return '課表'
  // 這裡的 items 是「id -> 進度」的物件；課表的 items 是待辦陣列
  if (Array.isArray(r.items)) return '別的 App'
  return null
}

/** 雲端的資料同樣要過驗證，不能直接信。 */
function adopt(raw: unknown): AppState | string {
  const foreign = foreignApp(raw)
  if (foreign) {
    return `這組密鑰已經被「${foreign}」用了。換一組新的密鑰，不要蓋掉那邊的資料`
  }
  const result = validateAppState(raw, ymd())
  return result.ok ? result.state : result.error
}

export async function pull(config: SyncConfig): Promise<PullResult> {
  try {
    const res = await fetch(urlFor(config), { method: 'GET', cache: 'no-store' })
    if (res.status === 404) return { status: 'empty' }
    if (!res.ok) return { status: 'error', message: describeHttpError(res.status) }

    const body = await res.json()
    const state = adopt(body.state)
    if (typeof state === 'string') {
      return { status: 'error', message: `雲端資料有問題，沒有套用：${state}` }
    }
    return { status: 'ok', record: { updatedAt: String(body.updatedAt), state } }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : '連不上同步伺服器' }
  }
}

export type PushResult =
  | { status: 'ok'; updatedAt: string }
  | { status: 'conflict'; remote: RemoteRecord }
  | { status: 'error'; message: string }

export async function push(config: SyncConfig, state: AppState): Promise<PushResult> {
  try {
    const res = await fetch(urlFor(config), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        // 帶上「我上次看到的版本」。雲端不一樣就代表另一台改過，不要蓋
        ...(config.lastSeen ? { 'If-Match': `"${config.lastSeen}"` } : {}),
      },
      body: JSON.stringify({ version: state.version, state }),
    })

    if (res.status === 409) {
      const body = await res.json()
      const remoteState = adopt(body.remote?.state)
      if (typeof remoteState === 'string') {
        return { status: 'error', message: `雲端有更新的版本，但讀不懂：${remoteState}` }
      }
      return {
        status: 'conflict',
        remote: { updatedAt: String(body.remote.updatedAt), state: remoteState },
      }
    }

    if (!res.ok) return { status: 'error', message: describeHttpError(res.status) }

    const body = await res.json()
    return { status: 'ok', updatedAt: String(body.updatedAt) }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : '連不上同步伺服器' }
  }
}

/** 強制蓋掉雲端，用在使用者選「用這台的」的時候。 */
export async function forcePush(config: SyncConfig, state: AppState): Promise<PushResult> {
  const current = await pull(config)
  const lastSeen = current.status === 'ok' ? current.record.updatedAt : null
  return push({ ...config, lastSeen }, state)
}

export async function remove(config: SyncConfig): Promise<void> {
  try {
    await fetch(urlFor(config), { method: 'DELETE' })
  } catch {
    // 刪不掉就算了，本機的設定還是會清掉
  }
}

/** 給衝突畫面用的摘要，讓使用者知道兩邊差在哪。 */
export function describeState(state: AppState): string {
  const learned = Object.keys(state.items).length
  const written = Object.keys(state.write).length
  const days = Object.keys(state.hist).length
  return `學過 ${learned} 個字、手寫練過 ${written} 個、練習紀錄 ${days} 天`
}

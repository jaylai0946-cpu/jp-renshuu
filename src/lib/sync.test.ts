import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildInviteLink,
  buildSetupLink,
  describeHttpError,
  generateKey,
  parseSetupLink,
  pull,
  validateEndpoint,
  validateKey,
} from './sync'

const CONFIG = {
  endpoint: 'https://jp-renshuu-sync.example.workers.dev',
  key: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  lastSeen: null,
  dirty: false,
}
const BASE = 'https://jaylai0946-cpu.github.io/jp-renshuu/'

describe('generateKey', () => {
  it('32 個小寫英數字', () => {
    for (let i = 0; i < 50; i++) expect(validateKey(generateKey())).toBeNull()
  })

  it('不會重複', () => {
    const keys = new Set(Array.from({ length: 200 }, generateKey))
    expect(keys.size).toBe(200)
  })
})

describe('validateEndpoint', () => {
  it('https 可以', () => {
    expect(validateEndpoint('https://x.workers.dev')).toBeNull()
  })

  it('localhost 放行，方便開發', () => {
    expect(validateEndpoint('http://localhost:8787')).toBeNull()
  })

  it('http 擋掉，不然資料會明文傳送', () => {
    expect(validateEndpoint('http://x.workers.dev')).toContain('https')
  })

  it('不是網址就擋掉', () => {
    expect(validateEndpoint('亂打')).toContain('網址格式')
  })

  it('填成 App 自己的網址會被擋（GitHub Pages 收 PUT 只會回 405）', () => {
    const self = 'https://jaylai0946-cpu.github.io'
    const msg = validateEndpoint(`${self}/jp-renshuu`, self)
    expect(msg).toContain('App 自己的網址')
    expect(msg).toContain('workers.dev')
  })

  it('同網域但不同 origin 的不受影響', () => {
    expect(validateEndpoint('https://x.workers.dev', 'https://jaylai0946-cpu.github.io')).toBeNull()
  })
})

describe('describeHttpError', () => {
  it('405 和 404 提示是網址填錯，不是伺服器壞了', () => {
    expect(describeHttpError(405)).toContain('workers.dev')
    expect(describeHttpError(404)).toContain('workers.dev')
  })

  it('其他狀態碼照實說', () => {
    expect(describeHttpError(413)).toContain('太大')
    expect(describeHttpError(500)).toContain('等一下再試')
    expect(describeHttpError(418)).toContain('418')
  })
})

describe('設定連結（自己的另一台裝置）', () => {
  it('帶得回原本的設定', () => {
    const link = buildSetupLink(CONFIG, BASE)
    expect(parseSetupLink(new URL(link).hash)).toEqual({
      kind: 'sync',
      endpoint: CONFIG.endpoint,
      key: CONFIG.key,
    })
  })

  it('密鑰放在 # 後面，不會被送到伺服器', () => {
    const link = buildSetupLink(CONFIG, BASE)
    expect(link.split('#')[0]).toBe(BASE)
    expect(link).toContain('#sync=')
  })

  it('網址裡的特殊字元 encode 過', () => {
    const link = buildSetupLink({ ...CONFIG, endpoint: 'https://x.dev/a?b=1' }, BASE)
    const parsed = parseSetupLink(new URL(link).hash)
    expect(parsed?.endpoint).toBe('https://x.dev/a?b=1')
  })

  it('尾巴多的斜線會清掉', () => {
    const link = buildSetupLink({ ...CONFIG, endpoint: 'https://x.workers.dev//' }, BASE)
    expect(parseSetupLink(new URL(link).hash)?.endpoint).toBe('https://x.workers.dev')
  })

  it.each([
    ['', '沒有 hash'],
    ['#', '空的'],
    ['#other=1', '不是設定連結'],
    ['#sync=https://x.workers.dev', '沒有分隔符號'],
    ['#sync=https://x.workers.dev|短', '密鑰不合格'],
    ['#sync=http://x.workers.dev|a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', 'http 不收'],
    ['#sync=亂打|a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', '不是網址'],
    ['#sync=%E0%A4%A|a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', '壞掉的 encoding'],
  ])('%s 不收（%s）', (hash) => {
    expect(parseSetupLink(hash)).toBeNull()
  })

  it('密鑰前後的空白會修掉（訊息軟體常自己加）', () => {
    const hash = `#sync=${encodeURIComponent(CONFIG.endpoint)}|${CONFIG.key} `
    const parsed = parseSetupLink(hash)
    expect(parsed?.kind).toBe('sync')
    expect(parsed?.kind === 'sync' && parsed.key).toBe(CONFIG.key)
  })
})

describe('邀請連結（分享給別人）', () => {
  it('只有網址，一個密鑰字元都不帶', () => {
    const link = buildInviteLink(CONFIG.endpoint, BASE)
    expect(link).not.toContain(CONFIG.key)
    expect(link).toContain('#invite=')
    expect(parseSetupLink(new URL(link).hash)).toEqual({
      kind: 'invite',
      endpoint: CONFIG.endpoint,
    })
  })

  it('kind 分得出來，呼叫端不會把邀請當成設定連結用', () => {
    const invite = parseSetupLink(new URL(buildInviteLink(CONFIG.endpoint, BASE)).hash)
    const setup = parseSetupLink(new URL(buildSetupLink(CONFIG, BASE)).hash)
    expect(invite?.kind).toBe('invite')
    expect(setup?.kind).toBe('sync')
  })

  it('尾巴多的斜線會清掉', () => {
    const link = buildInviteLink('https://x.workers.dev//', BASE)
    expect(parseSetupLink(new URL(link).hash)?.endpoint).toBe('https://x.workers.dev')
  })

  it.each([
    ['#invite=', '空網址'],
    ['#invite=http://x.workers.dev', 'http 不收'],
    ['#invite=亂打', '不是網址'],
    ['#invite=%E0%A4%A', '壞掉的 encoding'],
  ])('%s 不收（%s）', (hash) => {
    expect(parseSetupLink(hash)).toBeNull()
  })
})

describe('pull：擋掉別的 App 的資料', () => {
  const CFG = { endpoint: 'https://x.workers.dev', key: 'a'.repeat(32), lastSeen: null, dirty: false }

  function mockFetch(state: unknown) {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ version: 1, updatedAt: '2026-09-23T00:00:00Z', state }), {
        status: 200,
      }),
    )
  }

  afterEach(() => vi.unstubAllGlobals())

  it('課表的資料會被擋下來，不會被當成空白進度', async () => {
    // mcu-schedule 的 AppState 長這樣
    mockFetch({ version: 6, courses: [{ id: 'jpn' }], items: [], schoolEvents: [] })
    const result = await pull(CFG)
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toContain('課表')
  })

  it('items 是陣列（不是我們的形狀）也擋', async () => {
    mockFetch({ items: [1, 2, 3] })
    const result = await pull(CFG)
    expect(result.status).toBe('error')
  })

  it('自己的資料照常收', async () => {
    mockFetch({
      version: 1,
      items: { 'h:あ': { b: 3, due: '2026-09-25', seen: 4, wrong: 1 } },
      write: {},
      hist: {},
      settings: {},
      newDay: { d: '', n: 0 },
    })
    const result = await pull(CFG)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.record.state.items['h:あ'].b).toBe(3)
  })

  it('雲端還是空的（404）回 empty，不是錯誤', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    expect((await pull(CFG)).status).toBe('empty')
  })
})

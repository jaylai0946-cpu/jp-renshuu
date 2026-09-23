// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './worker.js'

const KEY = 'a'.repeat(32)
const BASE = 'https://jp-renshuu-sync.example.workers.dev'

/** 假的 KV。真的 KV 不是強一致，但單筆讀寫的行為一樣 */
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async get(key, options) {
      const raw = store.get(key)
      if (raw === undefined) return null
      return options === 'json' || options?.type === 'json' ? JSON.parse(raw) : raw
    },
    async put(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
  }
}

function req(path, init = {}) {
  return new Request(`${BASE}${path}`, init)
}

function post(path, body) {
  return req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Claude API 的回應：structured outputs 會把 JSON 放在 text block 裡 */
function claudeReply(result, extra = {}) {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }], ...extra }),
    { status: 200 },
  )
}

const GOOD = {
  verdict: 'minor',
  corrected: 'はじめまして。',
  reading: 'はじめまして。',
  romaji: 'hajimemashite.',
  explain: '意思對了，句尾加個句點更自然。',
  tip: '打招呼的固定說法，整句背起來。',
}

/** 有同步過進度 = 這組密鑰是真的使用者 */
function env(overrides = {}) {
  return {
    SYNC: fakeKV({ [`state:${KEY}`]: JSON.stringify({ version: 2, updatedAt: 'x', state: {} }) }),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ...overrides,
  }
}

describe('路由與密鑰', () => {
  it('不認得的路徑回 404', async () => {
    expect((await worker.fetch(req('/nope'), env())).status).toBe(404)
  })

  it('密鑰格式不對就擋掉，兩個路由都一樣', async () => {
    for (const path of ['/s/short', '/grade/short']) {
      const res = await worker.fetch(req(path, { method: 'POST' }), env())
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('32 個小寫英數字')
    }
  })

  it('OPTIONS 回 CORS 標頭', async () => {
    const res = await worker.fetch(req(`/grade/${KEY}`, { method: 'OPTIONS' }), env())
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
})

describe('同步還是照舊', () => {
  it('讀得到存進去的東西', async () => {
    const e = env({ SYNC: fakeKV() })
    const put = await worker.fetch(
      req(`/s/${KEY}`, { method: 'PUT', body: JSON.stringify({ version: 2, state: { items: {} } }) }),
      e,
    )
    expect(put.status).toBe(200)

    const get = await worker.fetch(req(`/s/${KEY}`), e)
    expect(get.status).toBe(200)
    expect((await get.json()).state).toEqual({ items: {} })
  })

  it('樂觀鎖：雲端被改過就回 409', async () => {
    const e = env()
    const res = await worker.fetch(
      req(`/s/${KEY}`, {
        method: 'PUT',
        // HTTP header 只能放 latin1，這裡故意給一個跟雲端不一樣的版本字串
        headers: { 'If-Match': '"2020-01-01T00:00:00.000Z"' },
        body: JSON.stringify({ version: 2, state: {} }),
      }),
      e,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).remote).toBeDefined()
  })
})

describe('/grade', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('只收 POST', async () => {
    expect((await worker.fetch(req(`/grade/${KEY}`), env())).status).toBe(405)
  })

  it('Worker 沒設 API key 就說清楚，不要假裝壞掉', async () => {
    const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env({ ANTHROPIC_API_KEY: '' }))
    expect(res.status).toBe(501)
    expect((await res.json()).error).toContain('ANTHROPIC_API_KEY')
  })

  it('沒同步過進度的密鑰不給用（防白嫖 API）', async () => {
    const res = await worker.fetch(
      post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }),
      env({ SYNC: fakeKV() }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('還沒同步過')
  })

  it('題目或答案是空的就擋，不要白打一次 API', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    for (const body of [{ prompt: '', answer: 'b' }, { prompt: 'a', answer: '  ' }, {}]) {
      expect((await worker.fetch(post(`/grade/${KEY}`, body), env())).status).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('太長的輸入擋掉', async () => {
    const res = await worker.fetch(
      post(`/grade/${KEY}`, { prompt: 'a', answer: 'x'.repeat(501) }),
      env(),
    )
    expect(res.status).toBe(400)
  })

  it('正常批改：回結果和用量', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD)))
    const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: '初次見面', answer: 'hajimemashite' }), env())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toEqual(GOOD)
    expect(body.used).toBe(1)
    expect(body.limit).toBe(50)
  })

  it('送出去的請求帶了 API key、模型和 schema', async () => {
    const spy = vi.fn(async () => claudeReply(GOOD))
    vi.stubGlobal('fetch', spy)
    await worker.fetch(post(`/grade/${KEY}`, { prompt: '初次見面', answer: 'x' }), env())

    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant-test')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')

    const sent = JSON.parse(init.body)
    expect(sent.model).toBe('claude-haiku-4-5')
    expect(sent.output_config.format.type).toBe('json_schema')
    expect(sent.output_config.format.schema.required).toContain('corrected')
    expect(sent.messages[0].content).toContain('初次見面')
  })

  it('每天有上限，用完回 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD)))
    const e = env()
    const day = new Date().toISOString().slice(0, 10)
    await e.SYNC.put(`grade:${KEY}:${day}`, '50')

    const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
    expect(res.status).toBe(429)
    expect((await res.json()).error).toContain('用完')
  })

  it('用量會累加', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD)))
    const e = env()
    for (const expected of [1, 2, 3]) {
      const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
      expect((await res.json()).used).toBe(expected)
    }
  })

  it('上游的錯誤不會原封不動吐回前端（可能含帳務訊息）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'credit balance too low' } }), { status: 400 })),
    )
    const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('credit')
  })

  it('上游 429 轉成 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    expect((await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())).status).toBe(429)
  })

  it('模型拒答時說人話', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD, { stop_reason: 'refusal' })))
    const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())
    expect(res.status).toBe(422)
  })

  it('連不上上游不會讓 Worker 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect((await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())).status).toBe(502)
  })

  it('失敗的請求不會算進用量', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const e = env()
    await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
    const day = new Date().toISOString().slice(0, 10)
    expect(await e.SYNC.get(`grade:${KEY}:${day}`)).toBeNull()
  })
})

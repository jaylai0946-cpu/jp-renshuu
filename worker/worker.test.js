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

  it('上游錯誤說得出是哪一類，管理員才知道要修什麼', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const cases = [
      [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'API key'],
      [400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, '額度不足'],
      [404, { error: { type: 'not_found_error', message: 'model' } }, '找不到模型'],
      [529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, '暫時有問題'],
    ]
    for (const [status, body, text] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
      const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())
      const { error } = await res.json()
      expect(res.status, String(status)).toBe(502)
      expect(error).toContain(text)
      expect(error).toContain(`代碼 ${status}`)
      expect(error).not.toContain('x-api-key')
    }
  })

  it('其他 400 把原因帶回來給管理員看，但遮掉 key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const body = { error: { type: 'invalid_request_error', message: 'output_config.format: bad schema (key sk-ant-api03-abc_DEF)' } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 400 })))
    const { error } = await (await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())).json()
    expect(error).toContain('原因：output_config.format: bad schema')
    expect(error).not.toContain('sk-ant-api03')
  })

  it('有設 ANTHROPIC_WORKSPACE_ID 才帶 workspace header', async () => {
    const f = vi.fn(async () => claudeReply(GOOD))
    vi.stubGlobal('fetch', f)
    await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), env())
    expect(f.mock.calls[0][1].headers['anthropic-workspace-id']).toBeUndefined()
    await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), { ...env(), ANTHROPIC_WORKSPACE_ID: 'wrkspc_1' })
    expect(f.mock.calls[1][1].headers['anthropic-workspace-id']).toBe('wrkspc_1')
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
    expect(await e.SYNC.get(`grade-all:${day}`)).toBeNull()
  })

  describe('全站每日上限', () => {
    const day = () => new Date().toISOString().slice(0, 10)

    /** 多開幾組都同步過的密鑰——模擬有人一直開新帳號 */
    function envWithKeys(keys, overrides = {}) {
      const initial = {}
      for (const k of keys) initial[`state:${k}`] = JSON.stringify({ version: 2, updatedAt: 'x', state: {} })
      return env({ SYNC: fakeKV(initial), ...overrides })
    }

    it('每次批改成功都算進全站用量', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD)))
      const e = env()
      await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
      await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
      expect(await e.SYNC.get(`grade-all:${day()}`)).toBe('2')
    })

    it('全站用完回 503，而且不會打到 Anthropic', async () => {
      const spy = vi.fn(async () => claudeReply(GOOD))
      vi.stubGlobal('fetch', spy)
      const e = env()
      await e.SYNC.put(`grade-all:${day()}`, '200')

      const res = await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)
      expect(res.status).toBe(503)
      expect((await res.json()).error).toContain('全站')
      expect(spy).not.toHaveBeenCalled()
    })

    it('一直開新帳號也繞不過：全部加起來不超過上限', async () => {
      const spy = vi.fn(async () => claudeReply(GOOD))
      vi.stubGlobal('fetch', spy)
      const keys = Array.from({ length: 10 }, (_, i) => String(i).repeat(32))
      const e = envWithKeys(keys, { GRADE_GLOBAL_DAILY: '15' })

      const statuses = []
      for (const k of keys) {
        for (let n = 0; n < 3; n++) {
          statuses.push((await worker.fetch(post(`/grade/${k}`, { prompt: 'a', answer: 'b' }), e)).status)
        }
      }
      expect(spy).toHaveBeenCalledTimes(15)
      expect(statuses.filter((s) => s === 200)).toHaveLength(15)
      expect(statuses.filter((s) => s === 503)).toHaveLength(15)
    })

    it('上限可以用環境變數改，0 就是暫停批改', async () => {
      const spy = vi.fn(async () => claudeReply(GOOD))
      vi.stubGlobal('fetch', spy)
      const res = await worker.fetch(
        post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }),
        env({ GRADE_GLOBAL_DAILY: '0' }),
      )
      expect(res.status).toBe(503)
      expect(spy).not.toHaveBeenCalled()
    })

    it('環境變數亂填就用預設的 200', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => claudeReply(GOOD)))
      const e = env({ GRADE_GLOBAL_DAILY: 'abc' })
      await e.SYNC.put(`grade-all:${day()}`, '199')
      expect((await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)).status).toBe(200)
      expect((await worker.fetch(post(`/grade/${KEY}`, { prompt: 'a', answer: 'b' }), e)).status).toBe(503)
    })
  })
})

describe('/song', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const day = () => new Date().toISOString().slice(0, 10)

  /** 照送出去的行號，每句回一筆分析 */
  function songReply(init) {
    const prompt = JSON.parse(init.body).messages[0].content
    const lines = [...prompt.matchAll(/^(\d+): (.+)$/gm)].map((m) => Number(m[1]))
    return claudeReply({
      lines: lines.map((i) => ({
        i,
        kana: `よみ${i}`,
        ro: `romaji${i}`,
        zh: `翻譯${i}`,
        words: [{ s: '空', k: 'そら', b: '', zh: '天空' }],
        note: '',
      })),
    })
  }

  const LYRICS = '青い空\n君と歩く\n\n青い空\n夢を見た'

  it('逐句分析；重複的句子只送一次，回來再展開', async () => {
    const spy = vi.fn(async (_url, init) => songReply(init))
    vi.stubGlobal('fetch', spy)
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', artist: 'A', lyrics: LYRICS }), env())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.song.lines.map((l) => l.jp)).toEqual(['青い空', '君と歩く', '青い空', '夢を見た'])
    expect(body.song.lines[0]).toEqual(body.song.lines[2])
    expect(body.song.lines[1]).toMatchObject({ kana: 'よみ1', zh: '翻譯1' })
    expect(body.used).toBe(1)

    // 送出去的只有三句不同的
    const sent = JSON.parse(spy.mock.calls[0][1].body)
    expect(sent.model).toBe('claude-haiku-4-5')
    expect(sent.output_config.format.type).toBe('json_schema')
    expect([...sent.messages[0].content.matchAll(/^\d+: /gm)]).toHaveLength(3)
  })

  it('模型漏掉的句子留原文，不讓整首失敗', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply({ lines: [{ i: 0, kana: 'あおいそら', ro: '', zh: '藍天', words: [], note: '' }] })))
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: '青い空\n君と歩く' }), env())
    const body = await res.json()
    expect(body.song.lines[0].kana).toBe('あおいそら')
    expect(body.song.lines[1]).toMatchObject({ jp: '君と歩く', kana: '', zh: '' })
  })

  it('沒同步過的密鑰不給用', async () => {
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), env({ SYNC: fakeKV() }))
    expect(res.status).toBe(403)
  })

  it('歌名或歌詞空的、太長的都擋，不打 API', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const tooMany = Array.from({ length: 61 }, (_, i) => `歌詞${i}`).join('\n')
    for (const body of [{ title: '', lyrics: LYRICS }, { title: '空', lyrics: '  ' }, { title: '空', lyrics: tooMany }, { title: '空', lyrics: 'あ'.repeat(4001) }]) {
      expect((await worker.fetch(post(`/song/${KEY}`, body), env())).status).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('每組密鑰每天 3 首，用完回 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => songReply(init)))
    const e = env()
    await e.SYNC.put(`song:${KEY}:${day()}`, '3')
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), e)
    expect(res.status).toBe(429)
  })

  it('一首歌在全站額度裡算 15 次批改；不夠就 503，不打 API', async () => {
    const spy = vi.fn(async (_url, init) => songReply(init))
    vi.stubGlobal('fetch', spy)
    const e = env()
    await e.SYNC.put(`grade-all:${day()}`, '190')
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), e)
    expect(res.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()

    await e.SYNC.put(`grade-all:${day()}`, '100')
    expect((await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), e)).status).toBe(200)
    expect(await e.SYNC.get(`grade-all:${day()}`)).toBe('115')
  })

  it('上游失敗不算次數，也不把上游訊息吐回去', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'credit balance too low' } }), { status: 400 })))
    const e = env()
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), e)
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('credit')
    expect(await e.SYNC.get(`song:${KEY}:${day()}`)).toBeNull()
  })

  it('分析到一半被截斷就說清楚', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReply({ lines: [] }, { stop_reason: 'max_tokens' })))
    const res = await worker.fetch(post(`/song/${KEY}`, { title: '空', lyrics: LYRICS }), env())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('太長')
  })
})

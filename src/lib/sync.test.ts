import { describe, expect, it } from 'vitest'
import {
  buildSetupLink,
  generateKey,
  parseSetupLink,
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
})

describe('setup link', () => {
  it('帶得回原本的設定', () => {
    const link = buildSetupLink(CONFIG, BASE)
    expect(parseSetupLink(new URL(link).hash)).toEqual({
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
    expect(parseSetupLink(new URL(link).hash)?.endpoint).toBe('https://x.dev/a?b=1')
  })

  it('尾巴多的斜線會清掉', () => {
    const link = buildSetupLink({ ...CONFIG, endpoint: 'https://x.workers.dev//' }, BASE)
    expect(parseSetupLink(new URL(link).hash)?.endpoint).toBe('https://x.workers.dev')
  })

  it.each([
    ['', '沒有 hash'],
    ['#', '空的'],
    ['#other=1', '不是同步連結'],
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
    expect(parseSetupLink(hash)?.key).toBe(CONFIG.key)
  })
})

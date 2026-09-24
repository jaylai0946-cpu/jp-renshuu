import { describe, expect, it } from 'vitest'
import { deriveKey, normalizeName, validateName, validatePassword } from './account'
import { validateKey } from './sync'

describe('deriveKey', () => {
  it('算出來的是合格的 32 字元密鑰', async () => {
    expect(validateKey(await deriveKey('jay', 'hunter2hunter2'))).toBeNull()
  })

  it('同一組名字密碼一定算出同一組密鑰（換裝置才登得回來）', async () => {
    const a = await deriveKey('jay', 'hunter2hunter2')
    const b = await deriveKey('jay', 'hunter2hunter2')
    expect(a).toBe(b)
  })

  it('不同的人算出不同的密鑰，資料才分得開', async () => {
    const mine = await deriveKey('jay', 'hunter2hunter2')
    const theirs = await deriveKey('mei', 'hunter2hunter2')
    expect(mine).not.toBe(theirs)
  })

  it('同一個名字換密碼就是另一份進度', async () => {
    const a = await deriveKey('jay', 'hunter2hunter2')
    const b = await deriveKey('jay', 'hunter2hunter3')
    expect(a).not.toBe(b)
  })

  it('名字的大小寫和前後空白不影響（不然會登不回去）', async () => {
    const base = await deriveKey('jay', 'hunter2hunter2')
    expect(await deriveKey('Jay', 'hunter2hunter2')).toBe(base)
    expect(await deriveKey('  JAY  ', 'hunter2hunter2')).toBe(base)
  })

  it('密碼的空白有意義，不修掉', async () => {
    const a = await deriveKey('jay', 'hunter2hunter2')
    const b = await deriveKey('jay', ' hunter2hunter2')
    expect(a).not.toBe(b)
  })

  it('中文名字和密碼也算得出來', async () => {
    expect(validateKey(await deriveKey('小賴', '這是我的密碼啦'))).toBeNull()
  })

  it('密鑰看不出原本的密碼', async () => {
    const key = await deriveKey('jay', 'hunter2hunter2')
    expect(key).not.toContain('hunter')
    expect(key).not.toContain('jay')
  })

  it('連續幾組名字都不會撞在一起', async () => {
    const keys = await Promise.all(
      ['a1', 'a2', 'a3', 'b1', 'b2'].map((n) => deriveKey(n, 'hunter2hunter2')),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('normalizeName', () => {
  it.each([
    ['  Jay ', 'jay'],
    ['MEI', 'mei'],
    ['小賴', '小賴'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected)
  })
})

describe('驗證', () => {
  it.each([
    ['', '至少'],
    [' a ', '至少'],
    ['x'.repeat(41), '太長'],
  ])('名字 %s 擋掉', (name, fragment) => {
    expect(validateName(name)).toContain(fragment)
  })

  it('合格的名字放行', () => {
    expect(validateName('jay')).toBeNull()
    expect(validateName('小賴')).toBeNull()
  })

  it.each([
    ['', '至少'],
    ['short', '至少'],
    ['x'.repeat(201), '太長'],
  ])('密碼 %s 擋掉', (password, fragment) => {
    expect(validatePassword(password)).toContain(fragment)
  })

  it('八個字以上放行', () => {
    expect(validatePassword('hunter2h')).toBeNull()
  })
})

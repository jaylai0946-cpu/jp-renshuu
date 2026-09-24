import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { DEFAULT_SYNC_ENDPOINT, STORAGE_KEY } from '../constants'
import { deriveKey } from '../lib/account'
import { emptyState } from '../lib/storage'
import type { AppState } from '../types'

const SYNC_KEY = 'jp-renshuu.sync'
const ENDPOINT = DEFAULT_SYNC_ENDPOINT

/** 雲端回 404 = 這組密鑰還沒有進度 */
function cloudEmpty() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
}

/** 雲端已經有進度 */
function cloudHas(state: AppState = emptyState()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ version: 2, updatedAt: '2026-09-24T00:00:00Z', state }), {
        status: 200,
      }),
    ),
  )
}

async function login(name: string, password: string) {
  // 伺服器網址已經寫在 constants 裡，登入頁不會問
  fireEvent.change(screen.getByLabelText('名字'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: '登入 / 建立' }))
}

function storedKey(): string | null {
  const raw = localStorage.getItem(SYNC_KEY)
  return raw ? JSON.parse(raw).key : null
}

describe('登入頁', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('第一次開啟先出登入頁，不是今日練習', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '登入 / 建立' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '開始今日練習' })).not.toBeInTheDocument()
  })

  it('登入之後才進得去 App', async () => {
    cloudEmpty()
    render(<App />)
    await login('jay', 'hunter2hunter2')

    await waitFor(() => expect(screen.getByRole('button', { name: '開始今日練習' })).toBeInTheDocument())
    expect(storedKey()).toBe(await deriveKey('jay', 'hunter2hunter2'))
  })

  it('兩個人登入會拿到不同的密鑰，各自同步', async () => {
    cloudEmpty()
    const { unmount } = render(<App />)
    await login('jay', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())
    const mine = storedKey()
    unmount()

    localStorage.clear()
    render(<App />)
    await login('mei', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())

    expect(storedKey()).not.toBe(mine)
  })

  it('換裝置用同一組名字密碼會回到同一份進度', async () => {
    cloudHas()
    render(<App />)
    await login('jay', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())
    expect(storedKey()).toBe(await deriveKey('jay', 'hunter2hunter2'))
  })

  it('雲端沒有這份進度時會問，避免密碼打錯卻默默開了新帳號', async () => {
    cloudEmpty()
    render(<App />)
    await login('jay', 'hunter2hunter2')

    await waitFor(() =>
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('打錯')),
    )
  })

  it('雲端已經有進度就不多問', async () => {
    cloudHas()
    render(<App />)
    await login('jay', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('在「要建立新的嗎」按取消就不登入', async () => {
    cloudEmpty()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    await login('jay', 'hunter2hunter2')

    await waitFor(() => expect(screen.getByRole('button', { name: '登入 / 建立' })).toBeInTheDocument())
    expect(storedKey()).toBeNull()
  })

  it('連不上伺服器就說清楚，不要假裝登入成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<App />)
    await login('jay', 'hunter2hunter2')

    await waitFor(() => expect(screen.getByText(/連不上|offline/)).toBeInTheDocument())
    expect(storedKey()).toBeNull()
  })

  it.each([
    ['a', 'hunter2hunter2', '名字至少'],
    ['jay', 'short', '密碼至少'],
  ])('名字 %s 密碼 %s 會擋下來', async (name, password, message) => {
    cloudEmpty()
    render(<App />)
    await login(name, password)
    await waitFor(() => expect(screen.getByText(new RegExp(message))).toBeInTheDocument())
    expect(storedKey()).toBeNull()
  })

  it('伺服器網址已經內建，登入頁不再問', () => {
    render(<App />)
    expect(screen.queryByLabelText('同步伺服器網址')).not.toBeInTheDocument()
    expect(screen.getByLabelText('名字')).toBeInTheDocument()
    expect(screen.getByLabelText('密碼')).toBeInTheDocument()
  })

  it('登入時打到內建的那台伺服器', async () => {
    cloudEmpty()
    render(<App />)
    await login('jay', 'hunter2hunter2')

    await waitFor(() => expect(storedKey()).not.toBeNull())
    const config = JSON.parse(localStorage.getItem(SYNC_KEY)!)
    expect(config.endpoint).toBe(DEFAULT_SYNC_ENDPOINT)
  })

  it('選「先不同步」可以直接進去，而且記得住', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '先不同步，只存在這台裝置' }))
    expect(screen.getByRole('button', { name: '開始今日練習' })).toBeInTheDocument()
    // 要先卸載，不然兩個 App 同時在 DOM 裡
    first.unmount()

    // 重開還是不跳登入
    render(<App />)
    expect(screen.getByRole('button', { name: '開始今日練習' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登入 / 建立' })).not.toBeInTheDocument()
  })

  it('設定連結進來的人不用再登入一次', () => {
    window.location.hash = `#sync=${encodeURIComponent(ENDPOINT)}|${'a'.repeat(32)}`
    render(<App />)
    expect(screen.queryByRole('button', { name: '登入 / 建立' })).not.toBeInTheDocument()
  })

  it('邀請連結進來的人也不用再登入一次', () => {
    window.location.hash = `#invite=${encodeURIComponent(ENDPOINT)}`
    render(<App />)
    expect(screen.queryByRole('button', { name: '登入 / 建立' })).not.toBeInTheDocument()
  })
})

describe('登出', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('登出會把本機進度一起清掉，下一個人不會看到上一個人的資料', async () => {
    cloudEmpty()
    const state = emptyState()
    state.items['h:あ'] = { b: 5, due: '2030-01-01', seen: 9, wrong: 0 }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    await login('jay', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.click(screen.getByRole('button', { name: '登出' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '登入 / 建立' })).toBeInTheDocument())
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ']).toBeUndefined()
    expect(localStorage.getItem(SYNC_KEY)).toBeNull()
  })

  it('推送還在飛的時候登出，同步設定不會被寫回來', async () => {
    // 推送卡住，登出之後才失敗回來——CI 上就是這個時序把設定復活的
    // 放在物件裡：TS 對「只在 closure 裡賦值的區域變數」會收斂成 never
    const gate: { release: (() => void) | null } = { release: null }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          await new Promise<void>((resolve) => {
            gate.release = resolve
          })
          return new Response('{}', { status: 500 })
        }
        return new Response('{}', { status: 404 })
      }),
    )

    render(<App />)
    await login('jay', 'hunter2hunter2')
    await waitFor(() => expect(storedKey()).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.click(screen.getByRole('button', { name: '登出' }))
    await waitFor(() => expect(localStorage.getItem(SYNC_KEY)).toBeNull())

    // 現在才讓那個推送失敗回來
    gate.release?.()
    await new Promise((r) => setTimeout(r, 50))

    expect(localStorage.getItem(SYNC_KEY)).toBeNull()
  })

  it('登出後「只存這台」的選擇也清掉，不然會跳過登入頁', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '先不同步，只存在這台裝置' }))
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.click(screen.getByRole('button', { name: '登出' }))

    expect(screen.getByRole('button', { name: '登入 / 建立' })).toBeInTheDocument()
  })
})

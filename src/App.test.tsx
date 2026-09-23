import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './constants'
import { UNIT_BY_ID } from './data/units'
import { ymd } from './lib/dates'
import { emptyState } from './lib/storage'
import type { AppState } from './types'

function seed(mutate: (s: AppState) => void) {
  const state = emptyState()
  mutate(state)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    // 固定亂數：0.9 讓反向題不會隨機冒出來，題目順序也才穩定
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
  })

  afterEach(() => vi.restoreAllMocks())

  it('第一次開啟：提示從平假名開始，今天有 10 題', () => {
    render(<App />)
    expect(screen.getByText('今天有 10 題')).toBeInTheDocument()
    expect(screen.getByText(/從平假名開始/)).toBeInTheDocument()
    expect(screen.getByText('平假名・清音')).toBeInTheDocument()
  })

  it('新字先出介紹卡，按「記住了」才出題', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    expect(screen.getByText('新しい字')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '記住了，出題吧' }))

    expect(screen.queryByText('新しい字')).not.toBeInTheDocument()
    expect(screen.getByText('這個怎麼唸？')).toBeInTheDocument()
  })

  it('答對會顯示「答對了」，進度存下來', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    fireEvent.click(screen.getByRole('button', { name: 'a' }))
    expect(screen.getByText('答對了')).toBeInTheDocument()

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(2)
    expect(saved.hist[ymd()]).toMatchObject({ n: 1, c: 1, xp: 10 })
  })

  it('答錯會亮出正確答案，盒子掉回 1', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.items['h:あ'] = { b: 5, due: '2020-01-01', seen: 9, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    const wrong = screen
      .getAllByRole('button')
      .find((b) => b.className.includes('choice') && b.textContent !== 'a')!
    fireEvent.click(wrong)

    expect(screen.getByText('正確答案是：a')).toBeInTheDocument()
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(1)
  })

  it('答錯的題目會在回合尾巴再出一次', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.items['h:あ'] = { b: 5, due: '2020-01-01', seen: 9, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    const wrong = screen
      .getAllByRole('button')
      .find((b) => b.className.includes('choice') && b.textContent !== 'a')!
    fireEvent.click(wrong)
    fireEvent.click(screen.getByRole('button', { name: '繼續' }))

    // 只有一題，答錯之後補一題，所以還沒結束
    expect(screen.getByText('再一次')).toBeInTheDocument()
  })

  it('做完一回合會蓋章並顯示正確率', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
    fireEvent.click(screen.getByRole('button', { name: 'a' }))
    fireEvent.click(screen.getByRole('button', { name: '繼續' }))

    expect(screen.getByText('済')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('「我已經會了」把整個單元標成盒子 3', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /單元/ }))

    const card = screen.getByText('平假名・清音').closest('.unit') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '我已經會了' }))

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    for (const it of UNIT_BY_ID['h1'].items) expect(saved.items[it.id].b).toBe(3)
  })

  it('紀錄頁顯示統計與印章日曆', () => {
    seed((s) => {
      s.items['h:あ'] = { b: 5, due: '2030-01-01', seen: 9, wrong: 0 }
      s.hist[ymd()] = { n: 10, c: 9, xp: 95, w: 0, h: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))

    expect(screen.getByText('學過的字')).toBeInTheDocument()
    expect(screen.getByText('熟練的字')).toBeInTheDocument()
    expect(screen.getAllByText('済').length).toBeGreaterThan(0)
  })

  it('貼上舊版 JSON 可以匯入，連續天數跟著出現', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))

    const legacy = JSON.stringify({
      v: 1,
      items: { 'h:あ': { b: 4, due: '2030-01-01', seen: 6, wrong: 1 } },
      hist: { [ymd()]: { n: 12, c: 10, xp: 110, w: 0 } },
      settings: { newPerDay: 15, romaji: false, sound: true },
      newDay: { d: ymd(), n: 8 },
    })
    fireEvent.change(screen.getByPlaceholderText(/貼上/), { target: { value: legacy } })
    fireEvent.click(screen.getByRole('button', { name: '匯入舊版進度' }))

    expect(screen.getByText(/匯入了 1 個字/)).toBeInTheDocument()
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(4)
    expect(saved.settings.newPerDay).toBe(15)
  })

  it('匯入亂貼的東西會被擋，進度不動', () => {
    seed((s) => {
      s.items['h:あ'] = { b: 5, due: '2030-01-01', seen: 9, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.change(screen.getByPlaceholderText(/貼上/), { target: { value: '???' } })
    fireEvent.click(screen.getByRole('button', { name: '匯入舊版進度' }))

    expect(screen.getByText(/不是合法的 JSON/)).toBeInTheDocument()
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(5)
  })

  it('設定連結會問要不要連上同步，並把密鑰從網址清掉', () => {
    const key = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    window.location.hash = `#sync=${encodeURIComponent('https://x.workers.dev')}|${key}`
    const replace = vi.spyOn(window.history, 'replaceState')

    render(<App />)

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('https://x.workers.dev'))
    expect(replace).toHaveBeenCalled()
    // enable 之後同步設定就存下來了
    const saved = JSON.parse(localStorage.getItem('jp-renshuu.sync')!)
    expect(saved).toMatchObject({ endpoint: 'https://x.workers.dev', key })
  })

  it('拒絕設定連結時不會啟用同步', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    window.location.hash = `#sync=${encodeURIComponent('https://x.workers.dev')}|a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

    render(<App />)

    expect(localStorage.getItem('jp-renshuu.sync')).toBeNull()
    expect(screen.getByText('進度存在這台裝置')).toBeInTheDocument()
  })

  it('亂七八糟的 hash 不會改到同步設定', () => {
    window.location.hash = '#sync=http://不安全|太短'
    render(<App />)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(localStorage.getItem('jp-renshuu.sync')).toBeNull()
  })

  it('關於頁有 KanjiVG 的授權標示', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.click(screen.getByRole('button', { name: '關於這個 App' }))

    expect(screen.getByRole('link', { name: 'KanjiVG' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CC BY-SA 3.0' })).toBeInTheDocument()
  })

  it('沒開同步時標示進度只存在這台', () => {
    render(<App />)
    expect(screen.getByText('進度存在這台裝置')).toBeInTheDocument()
  })

  it('階段 1 不會出默寫題（手寫畫布還沒做）', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 10
      for (const it of UNIT_BY_ID['h1'].items) {
        s.items[it.id] = { b: 3, due: '2030-01-01', seen: 3, wrong: 0 }
      }
    })
    render(<App />)
    expect(screen.getByText('今天的份做完了')).toBeInTheDocument()
  })
})

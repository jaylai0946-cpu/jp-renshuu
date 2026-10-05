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
    // 跳過登入頁：這些測試測的是登入之後的行為，登入本身在 Login.test.tsx
    localStorage.setItem('jp-renshuu.local-only', '1')
    // 預設把網路關掉。沒擋的話 #sync= 那幾個測試會真的打到 workers.dev，
    // 回應時間不可預測，非同步鏈會在下一個測試清掉 localStorage 之後才寫回去
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    window.location.hash = ''
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    // 固定亂數：0.9 讓反向題不會隨機冒出來，題目順序也才穩定
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
  })

  afterEach(() => vi.restoreAllMocks())

  it('第一次開啟：預設每天 10 個新字，每個考兩次所以是 20 題', () => {
    render(<App />)
    expect(screen.getByText('今天有 20 題')).toBeInTheDocument()
    expect(screen.getByText(/先教 10 個新字/)).toBeInTheDocument()
    expect(screen.getByText(/從平假名開始/)).toBeInTheDocument()
    expect(screen.getAllByText('平假名・清音').length).toBeGreaterThan(0)
  })

  it('一次連續教一批（預設 5 個），教完才開始出題', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    // 前五項都是介紹卡
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText('新しい字')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '記住了，出題吧' }))
    }

    // 第六項才是題目
    expect(screen.queryByText('新しい字')).not.toBeInTheDocument()
    expect(screen.getByText('這個怎麼唸？')).toBeInTheDocument()
  })

  it('介紹過的字會被記進進度，額度跟著扣', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
    fireEvent.click(screen.getByRole('button', { name: '記住了，出題吧' }))

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ']).toMatchObject({ b: 0 })
    expect(saved.newDay).toEqual({ d: ymd(), n: 1 })
  })

  it('一次教幾個可以在設定裡改', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.change(screen.getByLabelText(/一次教幾個/), { target: { value: '3' } })

    fireEvent.click(screen.getByRole('button', { name: /今日/ }))
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    for (let i = 0; i < 3; i++) {
      expect(screen.getByText('新しい字')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '記住了，出題吧' }))
    }
    expect(screen.queryByText('新しい字')).not.toBeInTheDocument()
  })

  it('答對會顯示「答對了」，進度存下來', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 0
      s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    fireEvent.click(screen.getByRole('button', { name: 'a' }))
    expect(screen.getByText('答對了！')).toBeInTheDocument()

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(2)
    expect(saved.hist[ymd()]).toMatchObject({ n: 1, c: 1, xp: 10 })
  })

  it('答錯會亮出正確答案，盒子掉回 1', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 0
      s.items['h:あ'] = { b: 5, due: '2020-01-01', seen: 9, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    const wrong = screen
      .getAllByRole('button')
      .find((b) => b.className.includes('choice') && b.textContent!.slice(1) !== 'a')!
    fireEvent.click(wrong)

    expect(screen.getByText(/正確答案是 a/)).toBeInTheDocument()
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.items['h:あ'].b).toBe(1)
  })

  describe('答對震動', () => {
    let buzz: ReturnType<typeof vi.fn>
    beforeEach(() => {
      buzz = vi.fn(() => true)
      Object.defineProperty(navigator, 'vibrate', { value: buzz, configurable: true, writable: true })
      seed((s) => {
        s.settings.newPerDay = 0
        s.settings.writePerDay = 0
        s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
      })
    })
    afterEach(() => {
      delete (navigator as { vibrate?: unknown }).vibrate
    })

    it('只有正確選項上有那層 label，而且連到隱形開關', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

      const hits = screen.getAllByTestId('haptic-hit')
      expect(hits).toHaveLength(1)
      expect(hits[0].parentElement!.querySelector('button')).toHaveAccessibleName('a')
      const sw = document.getElementById(hits[0].getAttribute('for')!) as HTMLInputElement
      expect(sw.type).toBe('checkbox')
      expect(sw.hasAttribute('switch')).toBe(true)
    })

    it('點正確選項（iPhone 實際點到的是 label）會答對並震一下', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

      const sw = document.querySelector<HTMLInputElement>('.haptic-switch')!
      fireEvent.click(screen.getByTestId('haptic-hit'))

      expect(screen.getByText('答對了！')).toBeInTheDocument()
      expect(sw.checked).toBe(true)
      expect(buzz).toHaveBeenCalledTimes(1)
      expect(buzz).toHaveBeenCalledWith(12)
      const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.hist[ymd()]).toMatchObject({ n: 1, c: 1 })
    })

    it('答完之後 label 還在但點不到，開關切換才不會被重繪打斷', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      fireEvent.click(screen.getByTestId('haptic-hit'))
      expect(screen.getByTestId('haptic-hit')).toHaveClass('off')
    })

    it('答錯不震', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      const wrong = screen
        .getAllByRole('button')
        .find((b) => b.className.includes('choice') && b.textContent!.slice(1) !== 'a')!
      fireEvent.click(wrong)

      expect(screen.getByText(/正確答案是 a/)).toBeInTheDocument()
      expect(buzz).not.toHaveBeenCalled()
    })

    it('設定關掉之後不震，也不放 label 和開關', () => {
      seed((s) => {
        s.settings.newPerDay = 0
        s.settings.writePerDay = 0
        s.settings.haptics = false
        s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
      })
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

      expect(screen.queryByTestId('haptic-hit')).not.toBeInTheDocument()
      expect(document.querySelector('.haptic-switch')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'a' }))
      expect(screen.getByText('答對了！')).toBeInTheDocument()
      expect(buzz).not.toHaveBeenCalled()
    })

    it('設定頁可以關掉', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
      const toggle = screen.getByRole('switch', { name: '答對時震動一下' })
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(toggle)
      const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.settings.haptics).toBe(false)
    })
  })

  it('答錯的題目會在回合尾巴再出一次', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 0
      s.items['h:あ'] = { b: 5, due: '2020-01-01', seen: 9, wrong: 0 }
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))

    const wrong = screen
      .getAllByRole('button')
      .find((b) => b.className.includes('choice') && b.textContent!.slice(1) !== 'a')!
    fireEvent.click(wrong)
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))

    // 只有一題，答錯之後補一題，所以還沒結束
    expect(screen.getByText('再一次')).toBeInTheDocument()
  })

  it('做完一回合會蓋章並顯示正確率', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 0
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

  describe('跳過這題', () => {
    beforeEach(() => {
      seed((s) => {
        s.settings.newPerDay = 0
        s.settings.writePerDay = 0
        s.items['h:あ'] = { b: 3, due: '2020-01-01', seen: 3, wrong: 0 }
        s.items['h:い'] = { b: 3, due: '2020-01-01', seen: 3, wrong: 0 }
      })
    })

    it('跳過不記對錯、不補考，進度原封不動', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      const before = localStorage.getItem(STORAGE_KEY)

      fireEvent.click(screen.getByRole('button', { name: '跳過這題' }))
      fireEvent.click(screen.getByRole('button', { name: '跳過這題' }))

      // 兩題都跳過就直接結算，沒有「再一次」
      expect(screen.queryByText('再一次')).not.toBeInTheDocument()
      expect(screen.getByText('0 / 0')).toBeInTheDocument()
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    })

    it('跳過一題、答對一題，結算只算答過的那題', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      fireEvent.click(screen.getByRole('button', { name: '跳過這題' }))
      const right = screen.getByTestId('haptic-hit').parentElement!.querySelector('button')!
      fireEvent.click(right)
      fireEvent.click(screen.getByRole('button', { name: '繼續' }))

      expect(screen.getByText('1 / 1')).toBeInTheDocument()
    })

    it('答完之後就沒有跳過鍵了', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      fireEvent.click(screen.getByTestId('haptic-hit').parentElement!.querySelector('button')!)
      expect(screen.queryByRole('button', { name: '跳過這題' })).not.toBeInTheDocument()
    })

    it('介紹卡沒有跳過鍵', () => {
      localStorage.removeItem(STORAGE_KEY)
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      expect(screen.getByText('新しい字')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '跳過這題' })).not.toBeInTheDocument()
    })

    it('默寫題也能跳過（沒帶筆的時候）', () => {
      seed((s) => {
        s.settings.newPerDay = 0
        s.settings.writePerDay = 1
        for (const it of UNIT_BY_ID['h1'].items) {
          s.items[it.id] = { b: 3, due: '2030-01-01', seen: 3, wrong: 0 }
        }
      })
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      expect(screen.getByText('憑記憶寫出來')).toBeInTheDocument()
      const before = localStorage.getItem(STORAGE_KEY)

      fireEvent.click(screen.getByRole('button', { name: '跳過這題' }))
      expect(screen.getByText('0 / 0')).toBeInTheDocument()
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    })
  })

  describe('外觀設定', () => {
    afterEach(() => {
      delete document.documentElement.dataset.theme
    })

    it('預設自動：不設 data-theme，交給系統', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
      expect(screen.getByRole('button', { name: '自動' })).toHaveAttribute('aria-pressed', 'true')
      expect(document.documentElement.dataset.theme).toBeUndefined()
    })

    it('選深色、淺色會設 data-theme，存進設定；切回自動會拿掉', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))

      fireEvent.click(screen.getByRole('button', { name: '深色' }))
      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.theme).toBe('dark')

      fireEvent.click(screen.getByRole('button', { name: '淺色' }))
      expect(document.documentElement.dataset.theme).toBe('light')

      fireEvent.click(screen.getByRole('button', { name: '自動' }))
      expect(document.documentElement.dataset.theme).toBeUndefined()
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.theme).toBe('auto')
    })

    it('重新整理後記得選過的外觀', () => {
      seed((s) => {
        s.settings.theme = 'dark'
      })
      render(<App />)
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
  })

  describe('鍵盤操作', () => {
    beforeEach(() => {
      seed((s) => {
        s.settings.newPerDay = 0
        s.settings.writePerDay = 0
        s.items['h:あ'] = { b: 3, due: '2020-01-01', seen: 3, wrong: 0 }
        s.items['h:い'] = { b: 3, due: '2020-01-01', seen: 3, wrong: 0 }
      })
    })

    function choiceIndexOf(name: string): number {
      const buttons = screen.getAllByRole('button').filter((b) => b.className.includes('choice'))
      return buttons.findIndex((b) => b.textContent!.slice(1) === name)
    }

    it('數字鍵選答案、Enter 繼續', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      const answer = screen.getByTestId('haptic-hit').parentElement!.querySelector('button')!
      const n = choiceIndexOf(answer.textContent!.slice(1)) + 1

      fireEvent.keyDown(window, { key: String(n) })
      expect(screen.getByText('答對了！')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByText('答對了！')).not.toBeInTheDocument()
    })

    it('S 跳過這題', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      const before = localStorage.getItem(STORAGE_KEY)
      fireEvent.keyDown(window, { key: 's' })
      fireEvent.keyDown(window, { key: 'S' })
      expect(screen.getByText('0 / 0')).toBeInTheDocument()
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    })

    it('打字的時候不會被當成快捷鍵', () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
      const input = document.createElement('input')
      document.body.appendChild(input)
      fireEvent.keyDown(input, { key: '1' })
      fireEvent.keyDown(input, { key: 's' })
      expect(screen.getByRole('button', { name: '跳過這題' })).toBeInTheDocument()
      input.remove()
    })
  })

  describe('隨機複習可以一直用', () => {
    /** 把一回合答完（每題都點正確答案），回到首頁 */
    function playRoundCorrectly() {
      for (let guard = 0; guard < 100; guard++) {
        if (screen.queryByRole('button', { name: '回首頁' })) break
        const hit = screen.queryByTestId('haptic-hit')
        if (hit && !hit.classList.contains('off')) {
          fireEvent.click(hit)
          continue
        }
        fireEvent.click(screen.getByRole('button', { name: '繼續' }))
      }
      fireEvent.click(screen.getByRole('button', { name: '回首頁' }))
    }

    beforeEach(() => {
      // 今天的份已經做完：學過的字都是明天才到期。默寫照預設開著
      seed((s) => {
        for (const it of UNIT_BY_ID['h1'].items.slice(0, 10)) {
          s.items[it.id] = { b: 1, due: '2099-01-01', seen: 1, wrong: 0 }
        }
        s.newDay = { d: ymd(), n: s.settings.newPerDay }
      })
    })

    it('連續複習兩次，按鈕都還在，也不會冒出新的今日題目', () => {
      render(<App />)
      expect(screen.getByText('今天的份做完了')).toBeInTheDocument()

      for (let round = 1; round <= 2; round++) {
        fireEvent.click(screen.getByRole('button', { name: /隨機複習/ }))
        expect(screen.getByText('這個怎麼唸？')).toBeInTheDocument()
        playRoundCorrectly()
        // 以前：複習答對讓字跳一格、提早進默寫，首頁變成「今天有 5 題」、複習按鈕消失
        expect(screen.getByText('今天的份做完了')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /隨機複習/ })).toBeInTheDocument()
      }
    })

    it('今天還有題目時，隨機複習的按鈕也在', () => {
      seed((s) => {
        s.items['h:あ'] = { b: 1, due: '2020-01-01', seen: 1, wrong: 0 }
      })
      render(<App />)
      expect(screen.getByRole('button', { name: '開始今日練習' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /隨機複習/ })).toBeInTheDocument()
    })
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

  it('邀請連結會產生一組新密鑰，不是沿用別人的', () => {
    window.location.hash = `#invite=${encodeURIComponent('https://x.workers.dev')}`
    render(<App />)

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('產生一組自己的密鑰'))
    const saved = JSON.parse(localStorage.getItem('jp-renshuu.sync')!)
    expect(saved.endpoint).toBe('https://x.workers.dev')
    expect(saved.key).toMatch(/^[a-z0-9]{32}$/)
  })

  it('兩個人用同一個邀請連結會拿到不同的密鑰', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 5; i++) {
      localStorage.clear()
      window.location.hash = `#invite=${encodeURIComponent('https://x.workers.dev')}`
      const { unmount } = render(<App />)
      keys.add(JSON.parse(localStorage.getItem('jp-renshuu.sync')!).key)
      unmount()
    }
    expect(keys.size).toBe(5)
  })

  it('已經在同步的裝置點到邀請連結不會被重設', () => {
    const mine = { endpoint: 'https://mine.workers.dev', key: 'b'.repeat(32), lastSeen: null, dirty: false }
    localStorage.setItem('jp-renshuu.sync', JSON.stringify(mine))
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    window.location.hash = `#invite=${encodeURIComponent('https://other.workers.dev')}`
    render(<App />)

    expect(alert).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('jp-renshuu.sync')!)).toMatchObject({
      endpoint: 'https://mine.workers.dev',
      key: 'b'.repeat(32),
    })
  })

  it('拒絕邀請連結時什麼都不設定', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    window.location.hash = `#invite=${encodeURIComponent('https://x.workers.dev')}`
    render(<App />)
    expect(localStorage.getItem('jp-renshuu.sync')).toBeNull()
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

  it('辨識熟了之後每日練習會出默寫題', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 3
      for (const it of UNIT_BY_ID['h1'].items) {
        s.items[it.id] = { b: 3, due: '2030-01-01', seen: 3, wrong: 0 }
      }
    })
    render(<App />)
    expect(screen.getByText('今天有 3 題')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '開始今日練習' }))
    expect(screen.getByText('憑記憶寫出來')).toBeInTheDocument()
    expect(screen.getByLabelText('手寫區')).toBeInTheDocument()
  })

  it('辨識還沒到盒子 2 的字不會出默寫題', () => {
    seed((s) => {
      s.settings.newPerDay = 0
      s.settings.writePerDay = 5
      for (const it of UNIT_BY_ID['h1'].items) {
        s.items[it.id] = { b: 1, due: '2030-01-01', seen: 1, wrong: 0 }
      }
    })
    render(<App />)
    expect(screen.getByText('今天的份做完了')).toBeInTheDocument()
  })
})

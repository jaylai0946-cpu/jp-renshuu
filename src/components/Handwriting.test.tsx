import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { STORAGE_KEY } from '../constants'
import { emptyState } from '../lib/storage'
import { KANJIVG_SIZE, outlineFor } from '../lib/strokes'
import type { AppState } from '../types'

/**
 * jsdom 沒有 canvas 2d context，也沒有 pointer capture。
 * 補最少的 stub，讓元件掛得起來——真正的筆跡行為靠瀏覽器實測，不在這裡測。
 */
function stubCanvas() {
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), save: vi.fn(),
    restore: vi.fn(), setLineDash: vi.fn(), lineCap: '', lineJoin: '', strokeStyle: '', fillStyle: '',
    lineWidth: 0, globalAlpha: 1,
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn()
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn()
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false)
  return ctx
}

function seed(mutate: (s: AppState) => void) {
  const state = emptyState()
  mutate(state)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function openWriting() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /手寫/ }))
}

describe('手寫分頁', () => {
  beforeEach(() => {
    localStorage.clear()
    // 跳過登入頁：這些測試測的是登入之後的行為，登入本身在 Login.test.tsx
    localStorage.setItem('jp-renshuu.local-only', '1')
    window.location.hash = ''
    stubCanvas()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0 as never)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  it('預設從看筆順開始，第一個字是あ', () => {
    openWriting()
    expect(screen.getByText('動畫依序畫出每一筆，標出順序和起筆點')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'あ 的筆順，共 3 筆' })).toBeInTheDocument()
  })

  it('三種模式切得動', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    expect(screen.getByLabelText('手寫區')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    expect(screen.getByText(/只給羅馬拼音/)).toBeInTheDocument()
  })

  it('默寫模式只顯示羅馬拼音，不露出假名', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    // 平假名 ぁ–ゖ、片假名 ァ–ヺ（不含「・」這類符號）
    const kana = /[ぁ-ゖァ-ヺ]/
    // 標題那格顯示的是 a 不是 あ
    const head = document.querySelector('.whead-mid')!
    expect(head.textContent).toContain('a')
    expect(head.textContent).not.toMatch(kana)
    // 電腦版的選字表也不能露出假名——紅底那格就是答案
    const grid = document.querySelector('.kanagrid')!
    expect(grid.textContent).not.toMatch(kana)
    expect(screen.getByRole('button', { name: '練寫 a' })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('button', { name: '練寫 あ' })).toBeNull()
  })

  it('換回看筆順，選字表又顯示假名', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    fireEvent.click(screen.getByRole('button', { name: '看筆順' }))
    expect(screen.getByRole('button', { name: '練寫 あ' })).toBeInTheDocument()
  })

  it('沒有固定的上一個／寫好了按鈕，發音在書寫卡的工具列', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))

    expect(screen.queryByRole('button', { name: '上一個' })).toBeNull()
    expect(screen.queryByRole('button', { name: '寫好了，下一個' })).toBeNull()
    // 還沒寫完也不會出現下一個／重來
    expect(screen.queryByRole('button', { name: '下一個' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重來' })).toBeNull()

    const speak = screen.getByRole('button', { name: /唸一次/ })
    expect(speak.closest('.wcard')).not.toBeNull()
  })

  it('字頭的箭頭會倒回去，第一個字會繞到最後一個', () => {
    openWriting()
    expect(screen.getByText(/第 1 \/ 46 個/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一個字' }))
    expect(screen.getByText(/第 46 \/ 46 個/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一個字' }))
    expect(screen.getByText(/第 1 \/ 46 個/)).toBeInTheDocument()
  })

  /** 照 KanjiVG 的筆畫一筆一筆描，畫布在 jsdom 裡位置是 (0,0) */
  function traceExactly(ch: string) {
    const canvas = screen.getByLabelText('手寫區') as HTMLCanvasElement
    const k = parseFloat(canvas.style.width) / KANJIVG_SIZE
    outlineFor(ch).forEach((stroke, n) => {
      const id = n + 1
      const at = (p: { x: number; y: number }) => ({ pointerId: id, pointerType: 'pen', clientX: p.x * k, clientY: p.y * k })
      fireEvent.pointerDown(canvas, at(stroke[0]))
      for (const p of stroke.slice(1)) fireEvent.pointerMove(canvas, at(p))
      fireEvent.pointerUp(canvas, at(stroke[stroke.length - 1]))
    })
  }

  /** 三筆都畫成同一條短橫線：筆畫數對，但形狀和筆順都錯 */
  function scribble(strokes: number) {
    const canvas = screen.getByLabelText('手寫區')
    for (let id = 1; id <= strokes; id++) {
      fireEvent.pointerDown(canvas, { pointerId: id, pointerType: 'pen', clientX: 5, clientY: 5 })
      fireEvent.pointerMove(canvas, { pointerId: id, pointerType: 'pen', clientX: 15, clientY: 6 })
      fireEvent.pointerUp(canvas, { pointerId: id, pointerType: 'pen', clientX: 15, clientY: 6 })
    }
  }

  it('寫對了出現「下一個」，按了換下一個字', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    traceExactly('あ')

    expect(screen.getByText('正確')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重來' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一個' }))
    expect(screen.getByText(/第 2 \/ 46 個/)).toBeInTheDocument()
    expect(screen.getByText('已寫 0 / 2 筆')).toBeInTheDocument()
  })

  it('寫錯了出現「重來」，按了清掉重寫，字不變', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    scribble(3)

    expect(screen.getByText('寫錯了')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一個' })).toBeNull()
    // 默寫寫錯可以先看答案
    expect(screen.getByRole('button', { name: '看答案' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重來' }))

    expect(screen.getByText(/第 1 \/ 46 個/)).toBeInTheDocument()
    expect(screen.getByText('已寫 0 / 3 筆')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重來' })).toBeNull()
  })

  it('寫完後工具列收起來，結果列取代它', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    scribble(3)
    expect(screen.queryByRole('button', { name: '上一筆復原' })).toBeNull()
    expect(screen.getByRole('status')).toHaveClass('wresult')
  })

  it('換字換單元都動得了，筆畫數跟著變', () => {
    openWriting()
    expect(screen.getByText(/第 1 \/ 46 個・共 3 筆/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一個字' }))
    // い 是 2 筆
    expect(screen.getByText(/第 2 \/ 46 個・共 2 筆/)).toBeInTheDocument()
  })

  it('拗音一題兩格，小字獨立佔一格', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '平假名 拗音' }))
    // 33 個拗音，每個是一題
    expect(screen.getByText(/第 1 \/ 33 個/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    // きゃ = き（4 筆）+ ゃ（3 筆），兩個畫布
    expect(screen.getAllByLabelText('手寫區')).toHaveLength(2)
    expect(screen.getByText('已寫 0 / 7 筆')).toBeInTheDocument()
  })

  it('片假名單元練的是片假名', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '片假名 清音' }))
    expect(screen.getByRole('img', { name: /ア 的筆順/ })).toBeInTheDocument()
  })

  it('提示不佔版面高度，不會把下面的按鈕推走', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))

    // 提示是蓋在畫布上的 overlay，不是流程裡的區塊——放在流程裡會把
    // 「寫好了，下一個」往下推，iPad 橫向就被推到底部導覽底下
    fireEvent.pointerDown(screen.getByLabelText('手寫區'), {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    })

    const hint = screen.getByRole('alert')
    expect(hint).toHaveClass('padhint')
    expect(hint.closest('.padstack')).not.toBeNull()
  })

  it('penOnly 開著時手指碰畫布會提示，可以一鍵關掉', () => {
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))

    const canvas = screen.getByLabelText('手寫區')
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })

    expect(screen.getByText(/現在只收 Apple Pencil/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '改用手指寫' }))

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.settings.penOnly).toBe(false)
  })

  it('penOnly 開著時筆電的滑鼠照樣寫得出來，也不跳提示', () => {
    // 回歸：以前 penOnly 擋掉所有不是筆的輸入，筆電完全寫不了字
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    const canvas = screen.getByLabelText('手寫區')

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 20 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 20 })

    expect(screen.getByText('已寫 1 / 3 筆')).toBeInTheDocument()
    expect(screen.queryByText(/現在只收 Apple Pencil/)).not.toBeInTheDocument()
  })

  it('關掉 penOnly 之後手指寫得出筆畫，復原和清除都有效', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    const canvas = screen.getByLabelText('手寫區')

    expect(screen.getByText('已寫 0 / 3 筆')).toBeInTheDocument()

    for (const id of [1, 2]) {
      fireEvent.pointerDown(canvas, { pointerId: id, pointerType: 'touch', clientX: 10, clientY: 10 })
      fireEvent.pointerMove(canvas, { pointerId: id, pointerType: 'touch', clientX: 60, clientY: 20 })
      fireEvent.pointerUp(canvas, { pointerId: id, pointerType: 'touch', clientX: 60, clientY: 20 })
    }
    expect(screen.getByText('已寫 2 / 3 筆')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一筆復原' }))
    expect(screen.getByText('已寫 1 / 3 筆')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(screen.getByText('已寫 0 / 3 筆')).toBeInTheDocument()
  })

  it('pointercancel（被系統手勢打斷）不會留下半截的筆畫', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    const canvas = screen.getByLabelText('手寫區')

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 20 })
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'touch' })

    expect(screen.getByText('已寫 0 / 3 筆')).toBeInTheDocument()
  })

  it('第二根手指不會插隊畫出第二條線', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    const canvas = screen.getByLabelText('手寫區')

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 90 })
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 90 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })

    expect(screen.getByText('已寫 1 / 3 筆')).toBeInTheDocument()
  })

  it('換字會把寫過的清掉，不會疊在新的字上', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    const canvas = screen.getByLabelText('手寫區')

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    expect(screen.getByText('已寫 1 / 3 筆')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一個字' }))
    expect(screen.getByText('已寫 0 / 2 筆')).toBeInTheDocument()
  })

  it('描寫模式：範本預設顯示，按鈕是「蓋住範本」而且真的會關掉', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))

    // 描寫時範本本來就在，所以按鈕是「蓋住範本」不是「看答案」
    const toggle = screen.getByRole('button', { name: '蓋住範本' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '顯示範本' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '顯示範本' }))
    expect(screen.getByRole('button', { name: '蓋住範本' })).toBeInTheDocument()
  })

  it('默寫模式：範本預設藏著，按鈕是「看答案」', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '默寫' }))

    fireEvent.click(screen.getByRole('button', { name: '看答案' }))
    expect(screen.getByRole('button', { name: '收起答案' })).toBeInTheDocument()
  })

  it('換模式時範本的顯示狀態跟著重設', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    fireEvent.click(screen.getByRole('button', { name: '蓋住範本' }))

    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    // 默寫預設藏著
    expect(screen.getByRole('button', { name: '看答案' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '描寫' }))
    // 回到描寫又預設顯示
    expect(screen.getByRole('button', { name: '蓋住範本' })).toBeInTheDocument()
  })

  it('換字時範本的顯示狀態也跟著重設', () => {
    seed((s) => { s.settings.penOnly = false })
    openWriting()
    fireEvent.click(screen.getByRole('button', { name: '默寫' }))
    fireEvent.click(screen.getByRole('button', { name: '看答案' }))

    fireEvent.click(screen.getByRole('button', { name: '下一個字' }))
    expect(screen.getByRole('button', { name: '看答案' })).toBeInTheDocument()
  })

  it('設定頁可以關掉只用 Apple Pencil', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /紀錄/ }))
    fireEvent.click(screen.getByRole('switch', { name: '只用 Apple Pencil 書寫' }))

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.settings.penOnly).toBe(false)
  })
})

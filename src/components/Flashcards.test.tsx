import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UNIT_BY_ID } from '../data/units'
import { Flashcards } from './Flashcards'
import { GameMotion } from '../lib/motion'
import { AnimatedNumber } from './ui'

describe('字卡', () => {
  const unit = UNIT_BY_ID['h1']
  const card = () => document.querySelector('.fcard') as HTMLElement

  it('點一下翻面，再點翻回來', () => {
    render(<Flashcards unit={unit} onBack={() => {}} />)
    expect(card()).not.toHaveClass('flipped')
    fireEvent.pointerDown(card(), { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(card(), { pointerId: 1, clientX: 102 })
    expect(card()).toHaveClass('flipped')
    fireEvent.pointerDown(card(), { pointerId: 2, clientX: 100 })
    fireEvent.pointerUp(card(), { pointerId: 2, clientX: 100 })
    expect(card()).not.toHaveClass('flipped')
  })

  it('往左滑換下一張、往右滑回上一張；滑不夠遠就彈回原位', () => {
    render(<Flashcards unit={unit} onBack={() => {}} />)
    expect(screen.getByText(`1 / ${unit.items.length}`)).toBeInTheDocument()

    fireEvent.pointerDown(card(), { pointerId: 1, clientX: 200 })
    fireEvent.pointerMove(card(), { pointerId: 1, clientX: 120 })
    fireEvent.pointerUp(card(), { pointerId: 1, clientX: 120 })
    expect(screen.getByText(`2 / ${unit.items.length}`)).toBeInTheDocument()
    expect(card()).toHaveClass('enter-next')

    fireEvent.pointerDown(card(), { pointerId: 2, clientX: 100 })
    fireEvent.pointerMove(card(), { pointerId: 2, clientX: 130 })
    fireEvent.pointerUp(card(), { pointerId: 2, clientX: 130 })
    expect(screen.getByText(`2 / ${unit.items.length}`)).toBeInTheDocument()

    fireEvent.pointerDown(card(), { pointerId: 3, clientX: 100 })
    fireEvent.pointerMove(card(), { pointerId: 3, clientX: 190 })
    fireEvent.pointerUp(card(), { pointerId: 3, clientX: 190 })
    expect(screen.getByText(`1 / ${unit.items.length}`)).toBeInTheDocument()
  })

  it('鍵盤 ← → 換張；換張後回到正面', () => {
    render(<Flashcards unit={unit} onBack={() => {}} />)
    fireEvent.pointerDown(card(), { pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(card(), { pointerId: 1, clientX: 0 })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText(`2 / ${unit.items.length}`)).toBeInTheDocument()
    expect(card()).not.toHaveClass('flipped')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText(`${unit.items.length} / ${unit.items.length}`)).toBeInTheDocument()
  })

  it('背面的「唸一次」不會順便把卡片翻回去', () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] }
    vi.stubGlobal('speechSynthesis', synth)
    render(<Flashcards unit={unit} onBack={() => {}} />)
    fireEvent.pointerDown(card(), { pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(card(), { pointerId: 1, clientX: 0 })
    fireEvent.click(screen.getByRole('button', { name: /唸一次/ }))
    expect(card()).toHaveClass('flipped')
    vi.unstubAllGlobals()
  })
})

describe('滾動數字', () => {
  it('預設（原本的樣子）就是單純的數字', () => {
    const { container } = render(<AnimatedNumber value={1234} />)
    expect(container.textContent).toBe('1234')
    expect(container.querySelector('.anum-d')).toBeNull()
  })

  it('遊戲化：文字還是乾淨的數字，每一位數帶自己的位置', () => {
    const wrap = (v: number) => (
      <GameMotion.Provider value>
        <AnimatedNumber value={v} />
      </GameMotion.Provider>
    )
    const { container, rerender } = render(wrap(1234))
    expect(container.textContent).toBe('1234')
    const ds = [...container.querySelectorAll<HTMLElement>('.anum-d')]
    expect(ds.map((d) => d.style.getPropertyValue('--d'))).toEqual(['1', '2', '3', '4'])
    rerender(wrap(1240))
    expect(container.textContent).toBe('1240')
  })
})

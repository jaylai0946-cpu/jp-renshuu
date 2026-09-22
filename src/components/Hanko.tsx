interface Props {
  /** 印章中間的字 */
  glyph: string
  caption?: string
  big?: boolean
  /** 蓋章動畫，回合結束時用一次 */
  press?: boolean
  label?: string
}

export function Hanko({ glyph, caption, big, press, label }: Props) {
  const cls = ['hanko', big ? 'big' : '', press ? 'press' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} aria-label={label}>
      <b>{glyph}</b>
      {caption ? <span>{caption}</span> : null}
    </div>
  )
}

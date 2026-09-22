/** 田字格。拗音是兩個字，會排成兩格。 */
export function Cells({ text }: { text: string }) {
  const chars = [...text]
  return (
    <div className={`cells${chars.length > 1 ? ' two' : ''}`} lang="ja">
      {chars.map((c, i) => (
        <div className="cell" key={`${c}-${i}`}>
          {c}
        </div>
      ))}
    </div>
  )
}

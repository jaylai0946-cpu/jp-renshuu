/** 大字卡。拗音（きゃ）兩個字放在同一格，一起看、一起唸，不拆成兩格。 */
export function Cells({ text }: { text: string }) {
  const two = [...text].length > 1
  return (
    <div className="cells" lang="ja">
      <div className={`cell${two ? ' two' : ''}`}>{text}</div>
    </div>
  )
}

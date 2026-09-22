/**
 * 一律用本地時區的 YYYY-MM-DD 當日期 key。
 * 不用 ISO，因為 toISOString() 是 UTC，台灣時間半夜會算成前一天。
 */
export function ymd(d: Date = new Date()): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}

export function isDayString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

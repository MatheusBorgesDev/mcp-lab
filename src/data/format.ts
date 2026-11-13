const wholeReais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** "R$ 50" for whole reais, "R$ 52,50" otherwise, with a plain space after the symbol. */
export function formatPrice(cents: number): string {
  return (cents % 100 === 0 ? wholeReais : reais).format(cents / 100).replace(/\s/g, ' ')
}

/** "45 min", "1h", "1h30". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
}

const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Weekdays (0 = Sunday) as a barbershop sign writes them: "ter a sáb", "seg, qua a sáb". */
export function formatWeekdays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const day of sorted) {
    const run = runs.at(-1)
    if (run && day === run.at(-1)! + 1) run.push(day)
    else runs.push([day])
  }
  return runs
    .flatMap((run) => (run.length >= 3 ? [`${DAY[run[0]!]} a ${DAY[run.at(-1)!]}`] : run.map((d) => DAY[d])))
    .join(', ')
}

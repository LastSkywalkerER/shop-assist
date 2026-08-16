/** «5 расходов» / «1 расход» / «3 расхода». */
export function pluralizeExpenses(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return `${n} расходов`
  if (mod10 === 1) return `${n} расход`
  if (mod10 >= 2 && mod10 <= 4) return `${n} расхода`
  return `${n} расходов`
}

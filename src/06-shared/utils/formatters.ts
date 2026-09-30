const numberFormat = new Intl.NumberFormat('ru-RU')

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export function formatDate(value: string | null): string {
  if (value === null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU')
}

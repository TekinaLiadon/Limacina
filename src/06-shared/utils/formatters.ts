const numberFormat = new Intl.NumberFormat('ru-RU')
const pluralRules = new Intl.PluralRules('ru-RU')

export type PluralForms = {
  one: string
  few: string
  many: string
  other?: string
}

export function selectPluralForm(count: number, forms: PluralForms): string {
  const category = pluralRules.select(count)
  if (category === 'one') return forms.one
  if (category === 'few') return forms.few
  if (category === 'other') return forms.other ?? forms.few
  return forms.many
}

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export function formatCount(value: number, forms: PluralForms): string {
  return `${formatNumber(value)} ${selectPluralForm(value, forms)}`
}

export function formatDate(value: string | null): string {
  if (value === null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU')
}

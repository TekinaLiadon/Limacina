import type { DropdownOption } from '@/06-shared'

export const chatVisibilityOptions: DropdownOption[] = [
  { title: 'Полный', value: 'full' },
  { title: 'Только команды', value: 'system' },
  { title: 'Скрыт', value: 'hidden' },
]

export const graphicsModeOptions: DropdownOption[] = [
  { title: 'Быстрая', value: '0' },
  { title: 'Красивая', value: '1' },
  { title: 'Потрясающая', value: '2' },
  { title: 'Ручная', value: '3' },
]

export const mipmapOptions: DropdownOption[] = [
  { title: 'Выкл', value: '0' },
  { title: '1', value: '1' },
  { title: '2', value: '2' },
  { title: '3', value: '3' },
  { title: '4', value: '4' },
]

export const particlesOptions: DropdownOption[] = [
  { title: 'Все', value: '0' },
  { title: 'Уменьшенные', value: '1' },
  { title: 'Минимум', value: '2' },
]

export const cloudsOptions: DropdownOption[] = [
  { title: 'Включены', value: 'true' },
  { title: 'Упрощённые', value: 'fast' },
  { title: 'Выключены', value: 'false' },
]

export const guiScaleOptions: DropdownOption[] = [
  { title: 'Авто', value: '0' },
  { title: '1', value: '1' },
  { title: '2', value: '2' },
  { title: '3', value: '3' },
  { title: '4', value: '4' },
]

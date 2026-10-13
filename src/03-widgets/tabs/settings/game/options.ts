import type { DropdownOption } from '@/06-shared'
import type { GameChatVisibility, GameCloudsMode, GameOptions } from '@/05-entities'

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

type NumberGameKey = { [K in keyof GameOptions]-?: GameOptions[K] extends number ? K : never }[keyof GameOptions]
type BooleanGameKey = { [K in keyof GameOptions]-?: GameOptions[K] extends boolean ? K : never }[keyof GameOptions]

export type GameOptionField =
  | { kind: 'slider'; key: NumberGameKey; label: string; min: number; max: number; step?: number }
  | { kind: 'checkbox'; key: BooleanGameKey; label: string }
  | { kind: 'dropdown'; key: keyof GameOptions; label: string; options: DropdownOption[]; read: (options: GameOptions) => string; write: (value: string) => GameOptions[keyof GameOptions] }

export function sliderField<K extends NumberGameKey>(field: { key: K; label: string; min: number; max: number; step?: number }): GameOptionField {
  return { kind: 'slider', ...field }
}

export function checkboxField<K extends BooleanGameKey>(field: { key: K; label: string }): GameOptionField {
  return { kind: 'checkbox', ...field }
}

export function dropdownField<K extends keyof GameOptions>(field: { key: K; label: string; options: DropdownOption[]; read: (options: GameOptions) => string; write: (value: string) => GameOptions[K] }): GameOptionField {
  return { kind: 'dropdown', ...field }
}

export const graphicsOptionFields: GameOptionField[] = [
  sliderField({ key: 'fov', label: 'Угол обзора (FOV)', min: 30, max: 110 }),
  sliderField({ key: 'gamma', label: 'Яркость', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'renderDistance', label: 'Дальность прорисовки (чанки)', min: 2, max: 32 }),
  sliderField({ key: 'simulationDistance', label: 'Дальность симуляции (чанки)', min: 5, max: 32 }),
  sliderField({ key: 'maxFps', label: 'Максимум FPS', min: 10, max: 260, step: 10 }),
  dropdownField({ key: 'graphicsMode', label: 'Графика', options: graphicsModeOptions, read: (options) => String(options.graphicsMode), write: (value) => Number(value) }),
  dropdownField({ key: 'mipmapLevels', label: 'Детализация текстур (mipmap)', options: mipmapOptions, read: (options) => String(options.mipmapLevels), write: (value) => Number(value) }),
  dropdownField({ key: 'particles', label: 'Частицы', options: particlesOptions, read: (options) => String(options.particles), write: (value) => Number(value) }),
  dropdownField({ key: 'renderClouds', label: 'Облака', options: cloudsOptions, read: (options) => options.renderClouds, write: (value) => value as GameCloudsMode }),
  dropdownField({ key: 'guiScale', label: 'Масштаб интерфейса', options: guiScaleOptions, read: (options) => String(options.guiScale), write: (value) => Number(value) }),
  checkboxField({ key: 'enableVsync', label: 'Вертикальная синхронизация' }),
  checkboxField({ key: 'entityShadows', label: 'Тени существ' }),
  checkboxField({ key: 'ao', label: 'Мягкое освещение' }),
  checkboxField({ key: 'fullscreen', label: 'Полный экран при запуске' }),
]

export const soundOptionFields: GameOptionField[] = [
  sliderField({ key: 'soundMaster', label: 'Общая громкость', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundMusic', label: 'Музыка', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundRecord', label: 'Музыкальные блоки', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundWeather', label: 'Погода', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundBlock', label: 'Блоки', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundHostile', label: 'Враждебные существа', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundNeutral', label: 'Дружелюбные существа', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundPlayer', label: 'Игроки', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundAmbient', label: 'Окружение', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'soundVoice', label: 'Речь', min: 0, max: 1, step: 0.05 }),
]

export const chatOptionFields: GameOptionField[] = [
  dropdownField({ key: 'chatVisibility', label: 'Видимость чата', options: chatVisibilityOptions, read: (options) => options.chatVisibility, write: (value) => value as GameChatVisibility }),
  sliderField({ key: 'chatScale', label: 'Масштаб чата', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'chatWidth', label: 'Ширина чата', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'chatOpacity', label: 'Прозрачность фона', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'chatLineSpacing', label: 'Межстрочный интервал', min: 0, max: 1, step: 0.05 }),
  sliderField({ key: 'chatDelay', label: 'Задержка сообщений', min: 0, max: 6, step: 0.5 }),
  sliderField({ key: 'textBackgroundOpacity', label: 'Прозрачность фона текста', min: 0, max: 1, step: 0.05 }),
  checkboxField({ key: 'chatColors', label: 'Цвета в чате' }),
  checkboxField({ key: 'chatLinks', label: 'Ссылки в чате' }),
  checkboxField({ key: 'chatLinksPrompt', label: 'Спрашивать перед открытием ссылок' }),
]

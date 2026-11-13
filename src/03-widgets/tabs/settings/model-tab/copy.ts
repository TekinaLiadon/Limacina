export const SUBTABS_ARIA_LABEL: string = 'Формат модели'

export const MODEL_TAB_LABELS = {
  cpm: 'CPM',
  blockbench: 'BlockBench',
  figura: 'Figura',
} as const

export const MODEL_TAB_TITLES = {
  cpm: 'Модель CPM',
  blockbench: 'Модель BlockBench',
  figura: 'Figura',
} as const

export const EMPTY_STATES = {
  cpm: 'Загрузите модель, чтобы увидеть её здесь',
  blockbench: 'Загрузите .bbmodel, чтобы сконвертировать модель',
  figuraNoAvatars: 'Аватары Figura не найдены',
  figuraNoSelection: 'Выберите аватар из списка',
} as const

export const LIST_TITLES = {
  cpm: 'Загруженные модели CPM',
  blockbench: 'Загруженные модели BlockBench',
} as const

export const BLOCKBENCH_CARD_TITLE: string = MODEL_TAB_TITLES.blockbench

export const BLOCKBENCH_CARD_HINT: string = 'Модель сконвертирована в CPM, предпросмотр появится в игре'

export const ERRORS = {
  figuraAvatarMissing: 'Не удалось прочитать avatar.json аватара',
  figuraModelMissing: 'Не удалось прочитать model.bbmodel аватара',
  figuraTextureMissing: 'Не удалось прочитать текстуру аватара',
} as const

const BYTES_PER_MB = 1024 * 1024

const toMegabytes = (maxBytes: number): number => maxBytes / BYTES_PER_MB

export const FORMAT_HINTS = {
  cpm: (maxBytes: number): string =>
    `Формат: .cpmproject или .bbmodel, не более ${toMegabytes(maxBytes)} МБ`,
  blockbench: (maxBytes: number): string =>
    `Формат: .bbmodel, не более ${toMegabytes(maxBytes)} МБ`,
} as const

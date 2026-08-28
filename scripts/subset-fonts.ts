/**
 * Сабсеттер шрифтов.
 *
 * Берёт полный вариативный TTF, выбрасывает всё, кроме латиницы, кириллицы
 * и общих спецсимволов, пинит нужные веса и складывает результат в woff2 +
 * генерирует `fonts.scss` с корректными `@font-face` и `unicode-range`.
 *
 * Запуск:
 *   bun run fonts            — пересобрать все семейства из манифеста
 *   bun run fonts inter jost — только указанные (по slug)
 *
 * Как добавить новый шрифт:
 *   1. Найти вариативный TTF (обычно https://github.com/google/fonts/tree/main/ofl/<slug>).
 *   2. Дописать запись в SOURCES ниже: family, slug, url, нужные веса.
 *   3. `bun run fonts <slug>` — файлы и fonts.scss появятся в
 *      `src/01-app/assets/fonts/<slug>/`.
 *   4. Подключить в `src/01-app/assets/fonts/fonts.scss` и указать семейство
 *      в токенах темы (`--font-body` / `--font-display` / `--font-mono`).
 *
 * ВАЖНО: у одного `@font-face` должен быть ровно один `url()`. Несколько url()
 * в `src` — это список фолбэков формата, браузер берёт первый доступный
 * и остальные файлы не грузит (на этом уже один раз погорели).
 */
import subsetFont from 'subset-font'
import { convert } from 'fontverter'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT: string = path.resolve(import.meta.dir, '..')
const OUT_DIR: string = path.join(ROOT, 'src/01-app/assets/fonts')
const CACHE_DIR: string = path.join(ROOT, 'node_modules/.cache/limacina-fonts')

interface SubsetGroup {
  /** Имя попадает в имя файла: `{slug}-{weight}-{name}.woff2`. */
  name: string
  /** Диапазоны в синтаксисе CSS `unicode-range`. */
  ranges: string[]
}

/**
 * Границы подмножеств повторяют разбивку Google Fonts, чтобы браузер
 * догружал только нужный файл. В `latin` добавлены общие спецсимволы:
 * стрелки, математика, типографика.
 */
const GROUPS: SubsetGroup[] = [
  {
    name: 'latin',
    ranges: [
      'U+0000-00FF',
      'U+0131',
      'U+0152-0153',
      'U+02BB-02BC',
      'U+02C6',
      'U+02DA',
      'U+02DC',
      'U+0304',
      'U+0308',
      'U+0329',
      'U+2000-206F',
      'U+20AC',
      'U+2113',
      'U+2122',
      'U+2190-21BB',
      'U+2202',
      'U+2205',
      'U+2212',
      'U+2215',
      'U+221E',
      'U+2248',
      'U+2260',
      'U+2264-2265',
      'U+25A0-25FF',
      'U+2605-2606',
      'U+2610-2612',
      'U+FEFF',
      'U+FFFD',
    ],
  },
  {
    name: 'latin-ext',
    ranges: [
      'U+0100-02BA',
      'U+02BD-02C5',
      'U+02C7-02CC',
      'U+02CE-02D7',
      'U+02DD-02FF',
      'U+1D00-1DBF',
      'U+1E00-1E9F',
      'U+1EF2-1EFF',
      'U+2020',
      'U+20A0-20AB',
      'U+20AD-20C0',
      'U+2C60-2C7F',
      'U+A720-A7FF',
    ],
  },
  {
    name: 'cyrillic',
    ranges: ['U+0301', 'U+0400-045F', 'U+0490-0491', 'U+04B0-04B1', 'U+2116'],
  },
  {
    name: 'cyrillic-ext',
    ranges: [
      'U+0460-052F',
      'U+1C80-1C8A',
      'U+20B4',
      'U+2DE0-2DFF',
      'U+A640-A69F',
      'U+FE2E-FE2F',
    ],
  },
]

interface FontSource {
  /** Имя семейства в CSS. */
  family: string
  /** Папка и префикс файлов. */
  slug: string
  /** Полный вариативный (или статический) TTF. */
  url: string
  /** Веса, которые нужно запечь в статические файлы. */
  weights: number[]
  /** Прочие оси, которые нужно зафиксировать (например opsz у Inter). */
  axes?: Record<string, number>
  /** Зачем этот шрифт в проекте. */
  note: string
}

const SOURCES: FontSource[] = [
  {
    family: 'Inter',
    slug: 'inter',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf',
    weights: [400, 500],
    axes: { opsz: 14 },
    note: 'UI и body тем default и lime (замена Untitled Sans / Inter Variable)',
  },
  {
    family: 'Onest',
    slug: 'onest',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/onest/Onest%5Bwght%5D.ttf',
    weights: [400, 500],
    note: 'заголовки темы default (замена aeonikPro)',
  },
  {
    family: 'Inter Tight',
    slug: 'inter-tight',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/intertight/InterTight%5Bwght%5D.ttf',
    weights: [400, 500],
    note: 'заголовки темы lime (замена Goga)',
  },
  {
    family: 'JetBrains Mono',
    slug: 'jetbrains-mono',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf',
    weights: [400, 500],
    note: 'моноширинный: консоль, пути, числовые читалки',
  },
  {
    family: 'Manrope',
    slug: 'manrope',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf',
    weights: [400, 500],
    note: 'UI и заголовки темы "Ночная синь"',
  },
  {
    family: 'Jost',
    slug: 'jost',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jost/Jost%5Bwght%5D.ttf',
    weights: [300, 400, 500],
    note: 'UI и заголовки темы "Искра" (замена geomanist, вес 300 обязателен)',
  },
]

/** Разворачивает диапазоны `U+XXXX-YYYY` в строку с кодовыми точками. */
function rangesToText(ranges: string[]): string {
  const chars: string[] = []
  for (const cp of rangesToCodePoints(ranges)) {
    chars.push(String.fromCodePoint(cp))
  }
  return chars.join('')
}

function rangesToCodePoints(ranges: string[]): number[] {
  const points: number[] = []
  for (const range of ranges) {
    const body: string = range.replace(/^U\+/i, '')
    const [fromRaw, toRaw] = body.split('-')
    const from: number = parseInt(fromRaw, 16)
    const to: number = toRaw === undefined ? from : parseInt(toRaw, 16)
    for (let cp = from; cp <= to; cp += 1) {
      // суррогатные половины не являются самостоятельными символами
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      points.push(cp)
    }
  }
  return points
}

/**
 * Читает cmap шрифта и возвращает множество доступных кодовых точек.
 * Нужно, чтобы не плодить пустые файлы для подмножеств, которых в шрифте нет
 * (например, cyrillic-ext есть далеко не везде).
 */
function readCoverage(font: Buffer): Set<number> {
  const coverage = new Set<number>()
  const numTables: number = font.readUInt16BE(4)

  let cmapOffset = -1
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16
    if (font.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = font.readUInt32BE(record + 8)
      break
    }
  }
  if (cmapOffset < 0) return coverage

  const subtableCount: number = font.readUInt16BE(cmapOffset + 2)
  let best = -1
  let bestFormat = -1
  for (let i = 0; i < subtableCount; i += 1) {
    const record = cmapOffset + 4 + i * 8
    const offset = cmapOffset + font.readUInt32BE(record + 4)
    const format = font.readUInt16BE(offset)
    // формат 12 покрывает всё, формат 4 — только BMP
    if (format === 12 && bestFormat !== 12) {
      best = offset
      bestFormat = 12
    } else if (format === 4 && bestFormat < 4) {
      best = offset
      bestFormat = 4
    }
  }
  if (best < 0) return coverage

  if (bestFormat === 12) {
    const groups: number = font.readUInt32BE(best + 12)
    for (let i = 0; i < groups; i += 1) {
      const g = best + 16 + i * 12
      const start = font.readUInt32BE(g)
      const end = font.readUInt32BE(g + 4)
      for (let cp = start; cp <= end; cp += 1) coverage.add(cp)
    }
    return coverage
  }

  const segCountX2: number = font.readUInt16BE(best + 6)
  const segCount = segCountX2 / 2
  const endCodes = best + 14
  const startCodes = endCodes + segCountX2 + 2
  for (let i = 0; i < segCount; i += 1) {
    const end = font.readUInt16BE(endCodes + i * 2)
    const start = font.readUInt16BE(startCodes + i * 2)
    if (start === 0xffff) continue
    for (let cp = start; cp <= end; cp += 1) coverage.add(cp)
  }
  return coverage
}

async function loadSource(source: FontSource): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true })
  const cachePath: string = path.join(CACHE_DIR, `${source.slug}.ttf`)
  if (existsSync(cachePath)) {
    return readFile(cachePath)
  }

  const response = await fetch(source.url)
  if (!response.ok) {
    throw new Error(`${source.family}: не удалось скачать ${source.url} (${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(cachePath, buffer)
  return buffer
}

/** Удаляет ранее сгенерированные woff2, чтобы не оставлять мусор от прошлых запусков. */
async function cleanOutput(dir: string): Promise<void> {
  if (!existsSync(dir)) return
  for (const file of await readdir(dir)) {
    if (file.endsWith('.woff2')) {
      await unlink(path.join(dir, file))
    }
  }
}

interface Face {
  weight: number
  group: SubsetGroup
  file: string
  bytes: number
}

function renderScss(source: FontSource, faces: Face[]): string {
  const lines: string[] = [
    `/* ${source.family} — ${source.note}.`,
    ' *',
    ' * Сгенерировано `bun run fonts`, руками не править.',
    ' * Подмножества: латиница, кириллица и общие спецсимволы.',
    ' * Каждый файл — отдельный @font-face с unicode-range: несколько url()',
    ' * в одном src это список фолбэков, браузер возьмёт только первый.',
    ' */',
    '',
  ]

  for (const face of faces) {
    lines.push(
      '@font-face {',
      `  font-family: "${source.family}";`,
      '  font-style: normal;',
      `  font-weight: ${face.weight};`,
      '  font-display: swap;',
      `  src: url("${face.file}") format("woff2");`,
      `  unicode-range: ${face.group.ranges.join(', ')};`,
      '}',
      '',
    )
  }

  return lines.join('\n')
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} КБ`
}

async function buildFamily(source: FontSource): Promise<number> {
  const original: Buffer = await loadSource(source)
  const coverage: Set<number> = readCoverage(original)
  const dir: string = path.join(OUT_DIR, source.slug)
  await mkdir(dir, { recursive: true })
  await cleanOutput(dir)

  const usable: SubsetGroup[] = GROUPS.filter((group) => {
    const points = rangesToCodePoints(group.ranges)
    const covered = points.filter((cp) => coverage.has(cp)).length
    if (covered === 0) {
      console.log(`  ${source.family} ${group.name}: пропущено, в шрифте нет этих символов`)
      return false
    }
    return true
  })

  const faces: Face[] = []
  let total = 0

  for (const weight of source.weights) {
    for (const group of usable) {
      const expected: number[] = rangesToCodePoints(group.ranges).filter((cp) => coverage.has(cp))
      const subset: Buffer = await subsetFont(original, rangesToText(group.ranges), {
        targetFormat: 'woff2',
        variationAxes: { wght: weight, ...source.axes },
      })

      // Проверяем, что в файле реально лежат все ожидаемые символы:
      // молча потерянные глифы приводят к фолбэку на системный шрифт.
      const produced: Set<number> = readCoverage(
        Buffer.from(await convert(subset, 'truetype')),
      )
      const missing: number[] = expected.filter((cp) => !produced.has(cp))
      if (missing.length > 0) {
        const sample = missing
          .slice(0, 8)
          .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
          .join(', ')
        throw new Error(
          `${source.family} ${weight} ${group.name}: в результате нет ${missing.length} символов (${sample})`,
        )
      }

      const file = `${source.slug}-${weight}-${group.name}.woff2`
      await writeFile(path.join(dir, file), subset)
      faces.push({ weight, group, file, bytes: subset.byteLength })
      total += subset.byteLength
    }
  }

  await writeFile(path.join(dir, 'fonts.scss'), renderScss(source, faces))
  console.log(
    `  ${source.family}: ${faces.length} файлов, ${formatKb(total)} ` +
      `(источник ${formatKb(original.byteLength)})`,
  )
  return total
}

async function main(): Promise<void> {
  const filter: string[] = process.argv.slice(2)
  const targets: FontSource[] = filter.length
    ? SOURCES.filter((s) => filter.includes(s.slug))
    : SOURCES

  if (targets.length === 0) {
    console.error(`Не найдено семейств по фильтру: ${filter.join(', ')}`)
    console.error(`Доступные slug: ${SOURCES.map((s) => s.slug).join(', ')}`)
    process.exit(1)
  }

  console.log('Сабсеттинг шрифтов (латиница + кириллица + общие символы):')
  let total = 0
  for (const source of targets) {
    total += await buildFamily(source)
  }
  console.log(`Итого: ${formatKb(total)}`)
}

await main()

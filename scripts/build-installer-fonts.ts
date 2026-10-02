/**
 * Сборка шрифтов для NSIS-установщика (`src-tauri/windows/fonts/`).
 *
 * Нативному установщику (GDI, AddFontResourceExW) нужны полные TTF-файлы,
 * где латиница и кириллица лежат в одном файле — woff2-сабсеты из
 * `assets/fonts` для этого не подходят. Здесь берутся те же вариативные
 * TTF, что и у `subset-fonts.ts` (общий кэш), запекается нужный вес и
 * остаётся один файл на начертание.
 *
 * Результат коммитится в репозиторий, чтобы NSIS-сборка не зависела
 * от сети. Запуск после обновления шрифтов проекта:
 *   bun run build:installer-fonts
 */
import subsetFont from 'subset-font'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CACHE_DIR, SOURCES, loadSource, rangesToText } from './subset-fonts.ts'

const ROOT: string = path.resolve(import.meta.dir, '..')
const OUT_DIR: string = path.join(ROOT, 'src-tauri/windows/fonts')

/** Символы, которые могут встретиться в UI установщика. */
const INSTALLER_RANGES: string[] = [
  'U+0020-007E', // ASCII: латиница, цифры, пунктуация, пути
  'U+00A0-00FF', // неразрывный пробел, ©, типографика латиницы
  'U+0301', 'U+0400-045F', 'U+0490-0491', 'U+04B0-04B1', 'U+2116', // кириллица
  'U+0460-052F', 'U+1C80-1C8A', 'U+20B4', 'U+2DE0-2DFF', 'U+A640-A69F', 'U+FE2E-FE2F', // кириллица расширенная
  'U+2010-2039', // тире, кавычки-ёлочки, многоточие
]

interface InstallerFace {
  /** Slug из SOURCES subset-fonts.ts. */
  slug: string
  weight: number
  /** Имя выходного файла в src-tauri/windows/fonts. */
  file: string
  /** GDI-имя семейства. У Manrope по умолчанию остаётся «ExtraLight»
   * из name-таблицы вариативного исходника, хотя контуры инстансятся верно. */
  family: string
}

const FACES: InstallerFace[] = [
  // Manrope — body тем «Ночная синь», основной текст установщика
  { slug: 'manrope', weight: 400, file: 'manrope-400.ttf', family: 'Manrope' },
  { slug: 'manrope', weight: 500, file: 'manrope-500.ttf', family: 'Manrope Medium' },
  // Onest — display-шрифт тем default (заголовки страниц)
  { slug: 'onest', weight: 500, file: 'onest-500.ttf', family: 'Onest Medium' },
]

/**
 * Перезаписывает name-таблицу: GDI ищет семейство по nameID 1/16, поэтому
 * после инстансирования вариативного шрифта имя надо выравнивать вручную.
 * Чек-суммы GDI не проверяет, поэтому считаем только таблицу name.
 */
function patchFontNames(font: Buffer, family: string): Buffer {
  const postScript = family.replace(/\s+/g, '-')
  const replacements: Record<number, string> = {
    1: family,
    2: 'Regular',
    4: family,
    6: /\d{3}$/.test(family) ? `${postScript}-Regular` : postScript,
    16: family,
    17: 'Regular',
  }

  const numTables: number = font.readUInt16BE(4)
  let nameOffset = -1
  let nameLength = 0
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16
    if (font.toString('ascii', record, record + 4) === 'name') {
      nameOffset = font.readUInt32BE(record + 8)
      nameLength = font.readUInt32BE(record + 12)
      break
    }
  }
  if (nameOffset < 0) throw new Error('В шрифте нет таблицы name')

  const count: number = font.readUInt16BE(nameOffset + 2)
  const storageOffset: number = nameOffset + font.readUInt16BE(nameOffset + 4)

  interface Record {
    platform: number
    encoding: number
    language: number
    nameId: number
    data: Buffer
  }
  const records: Record[] = []
  for (let i = 0; i < count; i += 1) {
    const rec = nameOffset + 6 + i * 12
    const platform: number = font.readUInt16BE(rec)
    const nameId: number = font.readUInt16BE(rec + 6)
    const len: number = font.readUInt16BE(rec + 8)
    const strOff: number = storageOffset + font.readUInt16BE(rec + 10)
    const raw = font.subarray(strOff, strOff + len)
    let data = Buffer.from(raw)
    if (replacements[nameId]) {
      data = Buffer.from(replacements[nameId], platform === 3 ? 'utf16le' : 'latin1')
      if (platform === 3) data.swap16() // строки platform 3 хранятся в big-endian
    }
    records.push({
      platform,
      encoding: font.readUInt16BE(rec + 2),
      language: font.readUInt16BE(rec + 4),
      nameId,
      data,
    })
  }

  const headerSize = 6 + records.length * 12
  let storage = 0
  for (const r of records) storage += r.data.length
  const padded = Math.ceil((headerSize + storage) / 4) * 4
  const nameTable = Buffer.alloc(padded)
  nameTable.writeUInt16BE(0, 0)
  nameTable.writeUInt16BE(records.length, 2)
  nameTable.writeUInt16BE(headerSize, 4)
  let cursor = headerSize
  records.forEach((r, i) => {
    const rec = 6 + i * 12
    nameTable.writeUInt16BE(r.platform, rec)
    nameTable.writeUInt16BE(r.encoding, rec + 2)
    nameTable.writeUInt16BE(r.language, rec + 4)
    nameTable.writeUInt16BE(r.nameId, rec + 6)
    nameTable.writeUInt16BE(r.data.length, rec + 8)
    nameTable.writeUInt16BE(cursor - headerSize, rec + 10)
    r.data.copy(nameTable, cursor)
    cursor += r.data.length
  })

  // Сдвигаем офсеты таблиц, идущих в sfnt после name, на дельту длины.
  const delta = nameTable.length - nameLength
  const patched = Buffer.from(font)
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16
    const tag = font.toString('ascii', record, record + 4)
    if (tag === 'name') {
      patched.writeUInt32BE(nameTable.length, record + 12)
    } else if (font.readUInt32BE(record + 8) > nameOffset) {
      patched.writeUInt32BE(font.readUInt32BE(record + 8) + delta, record + 8)
    }
  }
  return Buffer.concat([
    patched.subarray(0, nameOffset),
    nameTable,
    patched.subarray(nameOffset + nameLength),
  ])
}

async function buildFace(face: InstallerFace): Promise<number> {
  const source = SOURCES.find((s) => s.slug === face.slug)
  if (!source) throw new Error(`В SOURCES нет шрифта «${face.slug}»`)
  const original = await loadSource(source)

  const ttf: Buffer = await subsetFont(
    original,
    rangesToText(INSTALLER_RANGES),
    {
      targetFormat: 'truetype',
      variationAxes: { wght: face.weight, ...source.axes },
    },
  )
  const named = patchFontNames(ttf, face.family)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, face.file), named)
  console.log(`  ${face.file}: ${(named.byteLength / 1024).toFixed(1)} КБ (${face.family})`)
  return named.byteLength
}

async function main(): Promise<void> {
  console.log(`Шрифты установщика → ${path.relative(ROOT, OUT_DIR)} (кэш: ${CACHE_DIR}):`)
  let total = 0
  for (const face of FACES) {
    total += await buildFace(face)
  }
  console.log(`Итого: ${(total / 1024).toFixed(1)} КБ`)
}

await main()

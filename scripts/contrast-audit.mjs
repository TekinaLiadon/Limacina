import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const THEMES_DIR = resolve('src/01-app/assets/themes')
const REPORT_PATH = resolve('scripts/contrast-report.md')
const compareDir = (() => {
  const index = process.argv.indexOf('--compare')
  return index !== -1 ? resolve(process.argv[index + 1]) : null
})()

const THRESHOLDS = { text: 4.5, large: 3, ui: 3, disabled: 3 }
const LEVEL_LABELS = { text: 'текст 4.5:1', large: 'крупный 3:1', ui: 'UI 3:1', disabled: 'disabled (advisory)' }

function parseThemeDeclarations(source) {
  const declarations = {}
  const pattern = /--([a-z0-9-]+):\s*([^;]+);/g
  let match = pattern.exec(source)
  while (match !== null) {
    declarations[`--${match[1]}`] = match[2].replace(/\s+/g, ' ').trim()
    match = pattern.exec(source)
  }
  return declarations
}

function resolveValue(value, declarations, depth = 0) {
  if (depth > 8) return value
  return value.replace(/var\((--?[a-z0-9-]+)\)/g, (_, name) => {
    const next = declarations[name]
    return next ? resolveValue(next, declarations, depth + 1) : name
  })
}

function parseColor(raw) {
  const value = raw.trim()
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const int = parseInt(hex[1], 16)
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a: 1 }
  }
  const hexShort = value.match(/^#([0-9a-f]{3})$/i)
  if (hexShort) {
    const chars = hexShort[1].split('')
    return {
      r: parseInt(chars[0] + chars[0], 16),
      g: parseInt(chars[1] + chars[1], 16),
      b: parseInt(chars[2] + chars[2], 16),
      a: 1,
    }
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    const [r, g, b] = parts
    const a = parts.length > 3 ? parts[3] : 1
    if ([r, g, b].some((c) => Number.isNaN(c))) return null
    return { r, g, b, a: a === undefined || Number.isNaN(a) ? 1 : a }
  }
  return null
}

function composite(top, bottom) {
  const alpha = top.a
  return {
    r: Math.round(top.r * alpha + bottom.r * (1 - alpha)),
    g: Math.round(top.g * alpha + bottom.g * (1 - alpha)),
    b: Math.round(top.b * alpha + bottom.b * (1 - alpha)),
    a: 1,
  }
}

function toHex({ r, g, b }) {
  const channel = (c) => c.toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function luminance({ r, g, b }) {
  const linear = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

function effectiveBackground(token, declarations) {
  const base = parseColor(resolveValue(declarations['--login-bg-primary'], declarations))
  const formRaw = parseColor(resolveValue(declarations['--login-bg-form'], declarations))
  const form = formRaw && formRaw.a < 1 ? composite(formRaw, base) : formRaw ?? base
  const raw = parseColor(resolveValue(declarations[token], declarations))
  if (!raw) return null
  return raw.a < 1 ? composite(raw, form) : raw
}

function effectiveForeground(token, declarations, fgAlpha, background) {
  const raw = parseColor(resolveValue(declarations[token], declarations))
  if (!raw) return null
  const alpha = fgAlpha ?? raw.a
  return alpha < 1 ? composite({ ...raw, a: alpha }, background) : raw
}

const PAIRS = [
  { fg: '--login-text-primary', bg: '--login-bg-form', level: 'text', label: 'Основной текст на карточках/формах' },
  { fg: '--login-text-secondary', bg: '--login-bg-form', level: 'text', label: 'Вторичный текст на формах' },
  { fg: '--login-text-muted', bg: '--login-bg-form', level: 'text', label: 'Подписи (caption-hint) на формах' },
  { fg: '--login-text-primary', bg: '--login-bg-primary', level: 'text', label: 'Заголовки на фоне приложения' },
  { fg: '--login-text-muted', bg: '--login-bg-primary', level: 'text', label: 'Версия/подписи на фоне приложения' },
  { fg: '--login-text-secondary', bg: '--surface-subtle', level: 'text', label: 'Текст строк на surface-subtle' },
  { fg: '--login-text-secondary', bg: '--surface-light', level: 'text', label: 'Текст на surface-light' },
  { fg: '--login-text-muted', bg: '--surface-subtle', level: 'text', label: 'Подписи на surface-subtle' },
  { fg: '--login-text-primary', bg: '--surface-input', level: 'text', label: 'Текст в полях ввода' },
  { fg: '--login-text-muted', bg: '--surface-input', level: 'text', label: 'Плейсхолдеры' },
  { fg: '--login-text-primary', bg: '--surface-active', level: 'text', label: 'Активный пункт segmented' },
  { fg: '--text-on-accent-fill', bg: '--accent-fill', level: 'text', label: 'Текст на акцентных кнопках', bgOver: 'form' },
  { fg: '--text-on-accent', bg: '--login-accent', level: 'text', label: 'Галочка/акцентная заливка', bgOver: 'form' },
  { fg: '--accent-text', bg: '--login-bg-form', level: 'text', label: 'Акцентный текст на формах' },
  { fg: '--accent-text', bg: '--accent-active-bg', level: 'text', label: 'Активные бейджи/пункты' },
  { fg: '--accent-text', bg: '--accent-subtle', level: 'text', label: 'Notice-блоки' },
  { fg: '--accent-text', bg: '--surface-light', level: 'text', label: 'Бейджи на surface-light' },
  { fg: '--error', bg: '--error-bg', level: 'text', label: 'Текст ошибок' },
  { fg: '--delete-text', bg: '--delete-bg', level: 'text', label: 'Danger-кнопки' },
  { fg: '--accent-fill', bg: '--login-bg-form', level: 'ui', label: 'Акцентная заливка (чекбокс/прогресс) на форме' },
  { fg: '--accent-text', bg: '--login-bg-form', level: 'ui', label: 'Акцентные иконки на форме' },
]

const DISABLED_PAIRS = [
  { fg: '--login-text-primary', fgAlpha: 0.4, bg: '--login-bg-form', level: 'disabled', label: 'Disabled primary 0.4' },
  { fg: '--login-text-secondary', fgAlpha: 0.5, bg: '--login-bg-form', level: 'disabled', label: 'Disabled secondary 0.5' },
  { fg: '--login-text-muted', fgAlpha: 0.4, bg: '--login-bg-form', level: 'disabled', label: 'Disabled muted 0.4' },
]

function evaluateTheme(themeName, declarations) {
  const rows = []
  for (const pair of [...PAIRS, ...DISABLED_PAIRS]) {
    const background = effectiveBackground(pair.bg, declarations)
    const foreground = effectiveForeground(pair.fg, declarations, pair.fgAlpha, background ?? { r: 0, g: 0, b: 0, a: 1 })
    if (!background || !foreground) {
      rows.push({ ...pair, status: 'missing' })
      continue
    }
    const ratio = contrastRatio(foreground, background)
    const threshold = THRESHOLDS[pair.level]
    rows.push({
      ...pair,
      ratio,
      threshold,
      status: ratio + 1e-9 >= threshold ? 'pass' : 'fail',
      fgHex: toHex(foreground),
      bgHex: toHex(background),
    })
  }
  return { themeName, rows }
}

function loadThemes(dir) {
  const themes = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.scss'))) {
    const source = readFileSync(join(dir, file), 'utf8')
    const block = source.match(/\[data-theme="([^"]+)"\]\s*\{([\s\S]*)\}/)
    if (!block) continue
    themes[block[1]] = parseThemeDeclarations(block[2])
  }
  return themes
}

const themes = loadThemes(THEMES_DIR)
const oldThemes = compareDir ? loadThemes(compareDir) : null
const results = Object.keys(themes).sort().map((name) => evaluateTheme(name, themes[name]))

const lines = []
lines.push('# Contrast audit (WCAG)', '')
const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
lines.push(`Запуск: ${stamp}. Пороги: текст 4.5:1, крупный/UI 3:1, disabled — advisory 3:1.`, '')

for (const result of results) {
  const fails = result.rows.filter((r) => r.status === 'fail')
  const advisories = result.rows.filter((r) => r.status === 'fail' && r.level === 'disabled')
  lines.push(`## ${result.themeName}`, '')
  lines.push('| Пара | Уровень | fg → bg | Ratio | Порог | Статус |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of result.rows) {
    if (row.status === 'missing') {
      lines.push(`| ${row.label} | — | токен не найден | — | — | ⚠ missing |`)
      continue
    }
    const mark = row.status === 'pass' ? 'ok' : row.level === 'disabled' ? 'FAIL (advisory)' : '**FAIL**'
    lines.push(`| ${row.label} | ${LEVEL_LABELS[row.level]} | \`${row.fgHex}\` → \`${row.bgHex}\` | ${row.ratio.toFixed(2)} | ${row.threshold}:1 | ${mark} |`)
  }
  const hardFails = fails.length - advisories.length
  lines.push('')
  lines.push(`Итог: провалов ${hardFails} (hard), advisory-провалов ${advisories.length}.`, '')
}

if (oldThemes) {
  lines.push('## Изменённые токены (старое → новое)', '')
  for (const name of Object.keys(themes).sort()) {
    const before = oldThemes[name] ?? {}
    const after = themes[name]
    const changed = Object.keys(after)
      .filter((token) => before[token] !== undefined && before[token] !== after[token])
      .filter((token) => parseColor(resolveValue(after[token], after)) !== null)
    if (changed.length === 0) continue
    lines.push(`**${name}**`, '')
    for (const token of changed) {
      lines.push(`- \`${token}\`: \`${before[token]}\` → \`${after[token]}\``)
    }
    lines.push('')
  }
}

const report = lines.join('\n')
writeFileSync(REPORT_PATH, report)

let hard = 0
let advisory = 0
for (const result of results) {
  for (const row of result.rows) {
    if (row.status !== 'fail') continue
    if (row.level === 'disabled') advisory += 1
    else hard += 1
  }
}
console.log(report)
console.log(`\nВсего: hard-провалов ${hard}, advisory ${advisory}. Отчёт: ${REPORT_PATH}`)

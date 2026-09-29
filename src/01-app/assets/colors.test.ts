import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const colorsScss = readFileSync(join(process.cwd(), 'src/01-app/assets/colors.scss'), 'utf-8')

type ZToken = { name: string; value: number }

const readZTokens = (): ZToken[] => [...colorsScss.matchAll(/--z-([a-z-]+):\s*(\d+);/g)].map((match) => ({
  name: match[1] ?? '',
  value: Number(match[2]),
}))

const findZToken = (name: string): ZToken => {
  const token = readZTokens().find((entry) => entry.name === name)
  if (!token) throw new Error(`--z-${name} не найден в colors.scss`)
  return token
}

describe('z-index scale in colors.scss', () => {
  it('keeps the scale strictly ascending in declaration order', () => {
    const tokens = readZTokens()
    expect(tokens.length).toBeGreaterThan(0)
    for (let i = 1; i < tokens.length; i += 1) {
      const prev = tokens[i - 1]
      const current = tokens[i]
      expect(current?.value ?? 0, `--z-${prev?.name} должен быть меньше --z-${current?.name}`).toBeGreaterThan(
        prev?.value ?? 0,
      )
    }
  })

  it('renders toast notifications above modal popup overlays', () => {
    expect(findZToken('notification').value).toBeGreaterThan(findZToken('popup').value)
  })

  it('renders tooltips above toast notifications', () => {
    expect(findZToken('tooltip').value).toBeGreaterThan(findZToken('notification').value)
  })
})

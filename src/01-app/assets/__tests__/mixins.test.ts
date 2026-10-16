import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mixinsScss = readFileSync(join(process.cwd(), 'src/01-app/assets/mixins.scss'), 'utf-8')

const ruleBody = (selector: string): string => {
  const match = mixinsScss.match(new RegExp(`${selector} \\{([^}]*)\\}`))
  if (!match) throw new Error(`Правило ${selector} не найдено в mixins.scss`)
  return match[1] ?? ''
}

describe('options panel mixin', () => {
  it('keeps the option title on a single line', () => {
    const title = ruleBody('&__item-title')

    expect(title).toContain('white-space: nowrap')
    expect(title).toContain('text-overflow: ellipsis')
    expect(title).toContain('min-width: 0')
  })
})

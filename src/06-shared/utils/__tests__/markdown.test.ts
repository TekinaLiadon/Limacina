import { describe, expect, it } from 'vitest'
import { renderMarkdown, resolveMarkdownUrl } from '../markdown'

describe('renderMarkdown', () => {
  it('renders headings, emphasis and lists', () => {
    const html = renderMarkdown('# Заголовок\n\n**жирный** и *курсив*\n\n- пункт')

    expect(html).toContain('<h1>Заголовок</h1>')
    expect(html).toContain('<strong>жирный</strong>')
    expect(html).toContain('<em>курсив</em>')
    expect(html).toContain('<li>пункт</li>')
  })

  it('converts single line breaks when breaks mode is on', () => {
    const html = renderMarkdown('первая строка\nвторая строка')

    expect(html).toContain('первая строка<br>')
    expect(html).toContain('вторая строка')
  })

  it('renders tables as gfm', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')

    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
  })

  it('renders an empty source to an empty string', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('strips script tags', () => {
    const html = renderMarkdown('до <script>alert(1)</script> после')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).toContain('до')
    expect(html).toContain('после')
  })

  it('strips event handler attributes', () => {
    const html = renderMarkdown('<img src="cover.png" onerror="alert(1)">')

    expect(html).toContain('cover.png')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('alert(1)')
  })

  it('drops javascript: hrefs but keeps the link text', () => {
    const html = renderMarkdown('[тык](javascript:alert(1))')

    expect(html).toContain('<a')
    expect(html).toContain('тык')
    expect(html).not.toContain('javascript:')
  })

  it('keeps safe absolute and relative links', () => {
    const html = renderMarkdown('[сайт](https://example.ru/page) и [файл](docs/readme.md)')

    expect(html).toContain('href="https://example.ru/page"')
    expect(html).toContain('href="docs/readme.md"')
  })
})

describe('resolveMarkdownUrl', () => {
  it('resolves a relative href against the base url directory', () => {
    expect(resolveMarkdownUrl('docs/readme.md', 'https://modrinth.com/mod/x')).toBe(
      'https://modrinth.com/mod/docs/readme.md',
    )
  })

  it('resolves a root-relative href against the base origin', () => {
    expect(resolveMarkdownUrl('/assets/icon.png', 'https://modrinth.com/mod/x')).toBe(
      'https://modrinth.com/assets/icon.png',
    )
  })

  it('keeps an absolute href as is', () => {
    expect(resolveMarkdownUrl('https://cdn.ru/a.png', 'https://modrinth.com/mod/x')).toBe(
      'https://cdn.ru/a.png',
    )
  })

  it('returns the href untouched when it cannot be parsed', () => {
    expect(resolveMarkdownUrl('docs/readme.md', 'не url')).toBe('docs/readme.md')
  })
})

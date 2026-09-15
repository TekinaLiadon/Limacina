import DOMPurify from 'dompurify'
import { marked } from 'marked'

const MODRINTH_BASE_URL = 'https://modrinth.com'

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: true })
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function resolveMarkdownUrl(href: string): string {
  try {
    return new URL(href, MODRINTH_BASE_URL).toString()
  } catch {
    return href
  }
}

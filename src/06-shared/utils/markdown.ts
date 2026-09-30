import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: true })
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function resolveMarkdownUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

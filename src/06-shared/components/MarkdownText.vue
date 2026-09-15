<script setup lang="ts">
import { computed } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { resolveMarkdownUrl, renderMarkdown } from '@/06-shared'

const props = defineProps<{
  source: string
}>()

const html = computed((): string => renderMarkdown(props.source))

function handleAnchorClick(event: MouseEvent): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const anchor = target.closest('a')
  if (anchor === null) return
  const href = anchor.getAttribute('href')
  if (href === null || href === '') return
  event.preventDefault()
  void openUrl(resolveMarkdownUrl(href))
}
</script>

<template>
  <div class="markdown-text" @click="handleAnchorClick" v-html="html" />
</template>

<style lang="scss">
.markdown-text {
  overflow-wrap: anywhere;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: var(--space-16) 0 var(--space-8);
    color: var(--login-text-primary);
    font-weight: var(--weight-medium);
    line-height: var(--leading-heading);
  }

  h1 {
    font-size: var(--text-heading-sm);
  }

  h2 {
    font-size: var(--text-subheading);
  }

  h3,
  h4,
  h5,
  h6 {
    font-size: 1em;
  }

  p {
    margin: 0 0 var(--space-8);
  }

  a {
    color: var(--accent-text);
    text-decoration: underline;
    cursor: pointer;

    &:hover {
      filter: brightness(1.15);
    }
  }

  ul,
  ol {
    margin: 0 0 var(--space-8);
    padding-left: var(--space-24);
  }

  li {
    margin: 0 0 var(--space-4);
  }

  code {
    padding: var(--space-4);
    border-radius: var(--radius-badge);
    background: var(--surface-light);
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  pre {
    margin: 0 0 var(--space-8);
    padding: var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-light);
    overflow-x: auto;

    code {
      padding: 0;
      background: none;
      border-radius: 0;
      font-size: inherit;
    }
  }

  blockquote {
    margin: 0 0 var(--space-8);
    padding: var(--space-4) var(--space-12);
    border-left: 2px solid var(--surface-light);
    color: var(--login-text-muted);
  }

  table {
    width: 100%;
    margin: 0 0 var(--space-8);
    border-collapse: collapse;
  }

  th,
  td {
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--surface-light);
    text-align: left;
  }

  th {
    background: var(--surface-subtle);
    font-weight: var(--weight-medium);
  }

  img {
    max-width: 100%;
    border-radius: var(--radius-card);
  }

  hr {
    margin: var(--space-16) 0;
    border: none;
    border-top: 1px solid var(--surface-light);
  }
}
</style>

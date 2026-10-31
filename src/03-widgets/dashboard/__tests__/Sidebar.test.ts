import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Sidebar from '../Sidebar.vue'

const sidebarSource = readFileSync(join(process.cwd(), 'src/03-widgets/dashboard/Sidebar.vue'), 'utf-8')
const barStylesStart = sidebarSource.indexOf('@include breakpoints.media-under-lg')

const sidebarStyles = sidebarSource.slice(0, barStylesStart)
const barStyles = sidebarSource.slice(barStylesStart)

const mountSidebar = (activeTab: 'accounts' | 'settings' = 'accounts') =>
  mount(Sidebar, {
    props: { activeTab },
    global: { plugins: [createPinia()] },
  })

describe('Sidebar item markup', () => {
  it('keeps an icon and a label inside every row', () => {
    const rows = mountSidebar().findAll('button.sidebar__item')

    expect(rows.length).toBe(3)
    for (const row of rows) {
      expect(row.find('.sidebar__icon').exists()).toBe(true)
      expect(row.find('.sidebar__label').exists()).toBe(true)
    }
  })

  it('marks the current tab with the active modifier', () => {
    const [first] = mountSidebar().findAll('button.sidebar__item')

    expect(first?.classes()).toContain('sidebar__item--active')
  })

  it('types every row as a button and marks the active one with aria-current', () => {
    const rows = mountSidebar().findAll('button.sidebar__item')

    for (const row of rows) {
      expect(row.attributes('type')).toBe('button')
    }
    expect(rows[0]?.attributes('aria-current')).toBe('page')
    expect(rows[1]?.attributes('aria-current')).toBeUndefined()
    expect(rows[2]?.attributes('aria-current')).toBeUndefined()
  })

  it('gives the debug row its own icon instead of the settings glyph', () => {
    expect(sidebarSource).toContain('<Icon type="console" />')
    expect(sidebarSource.match(/<Icon type="settings" \/>/g)).toHaveLength(1)
  })
})

describe('Sidebar hover response', () => {
  it('moves the icon together with the label instead of the glyph inside the circle', () => {
    expect(sidebarStyles).toMatch(/&:hover \.sidebar__icon,\s*&:hover \.sidebar__label \{\s*transform: translateX\(var\(--space-4\)\);/)
    expect(sidebarStyles).not.toContain('translateX(var(--space-2))')
  })

  it('gives the label its own transform transition', () => {
    expect(sidebarStyles).toMatch(/\.sidebar__label \{\s*transition: transform var\(--duration-base\) var\(--ease-out\);/)
  })

  it('keeps every hover transition on the base duration', () => {
    expect(sidebarStyles).not.toContain('var(--duration-fast)')
  })

  it('keeps the accent circle of the active item intact on hover', () => {
    expect(sidebarStyles).toContain('&:hover:not(.sidebar__item--active) .sidebar__icon {')
  })

  it('keeps the shared hover fill and text color', () => {
    expect(sidebarStyles).toMatch(/%sidebar-link-state \{\s*color: var\(--login-text-primary\);\s*background: var\(--surface-light\);/)
    expect(sidebarStyles).toMatch(/&:hover \{\s*@extend %sidebar-link-state;/)
  })

  it('drops the shift but keeps the icon highlight in the bottom bar', () => {
    expect(barStyles).toMatch(/&:hover \.sidebar__icon,\s*&:hover \.sidebar__label \{\s*transform: none;/)
    expect(barStyles).not.toContain('background-color: transparent;')
    expect(sidebarStyles).toMatch(/&:hover:not\(\.sidebar__item--active\) \.sidebar__icon \{\s*background-color: var\(--surface-hover\);/)
  })

  it('paints the press state of the bottom bar with the active surface', () => {
    expect(barStyles).toMatch(/&:active \{\s*background: var\(--surface-active\);/)
  })
})

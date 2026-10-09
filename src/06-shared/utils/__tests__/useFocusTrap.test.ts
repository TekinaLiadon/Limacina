import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useFocusTrap } from '../useFocusTrap'
import { withSetup } from '@/test-support/withSetup'

const buildTrap = (isActive: () => boolean): void => {
  const container = document.createElement('div')
  const first = document.createElement('button')
  const second = document.createElement('button')
  container.appendChild(first)
  container.appendChild(second)
  document.body.appendChild(container)
  withSetup(() => useFocusTrap(ref(container), isActive))
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('wraps the tab focus at the container bounds while active', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    expect(container).not.toBeNull()
    if (!container) return
    const button = container.querySelector('button')
    if (!button) return
    button.focus()
    expect(document.activeElement).toBe(button)

    const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    active.value = true
    await Promise.resolve()
    container.dispatchEvent(forward)

    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it('ignores keys while inactive', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    if (!container) return
    const button = container.querySelector('button')
    if (!button) return
    button.focus()

    const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    container.dispatchEvent(forward)

    expect(forward.defaultPrevented).toBe(false)
  })

  it('lets the escape key pass through', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    if (!container) return
    const button = container.querySelector('button')
    if (!button) return
    button.focus()

    active.value = true
    await Promise.resolve()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    container.dispatchEvent(escape)

    expect(escape.defaultPrevented).toBe(false)
  })

  it('does not move the initial focus on activation', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    active.value = true
    await Promise.resolve()
    await Promise.resolve()

    expect(document.activeElement).toBe(outside)
  })

  it('restores the focus on deactivation', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    if (!container) return
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    active.value = true
    await Promise.resolve()
    active.value = false
    await Promise.resolve()

    expect(document.activeElement).toBe(outside)
  })
})

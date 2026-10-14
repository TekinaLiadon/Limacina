import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useFocusTrap } from '../useFocusTrap'
import { withSetup } from '@/test-support/withSetup'

const unmountFns: Array<() => void> = []

const buildTrap = (isActive: () => boolean): void => {
  const container = document.createElement('div')
  container.tabIndex = -1
  const first = document.createElement('button')
  const second = document.createElement('button')
  container.appendChild(first)
  container.appendChild(second)
  document.body.appendChild(container)
  const { unmount } = withSetup(() => useFocusTrap(ref(container), isActive))
  unmountFns.push(unmount)
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    unmountFns.splice(0).forEach((unmount) => unmount())
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

  it('activates on mount when the popup is already active', async () => {
    const active = ref(true)
    const container = document.createElement('div')
    const first = document.createElement('button')
    const second = document.createElement('button')
    container.appendChild(first)
    container.appendChild(second)
    document.body.appendChild(container)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    withSetup(() => useFocusTrap(ref(container), () => active.value))
    await Promise.resolve()

    const button = container.querySelector('button')
    if (!button) return
    button.focus()

    const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    container.dispatchEvent(forward)

    expect(forward.defaultPrevented).toBe(true)

    active.value = false
    await Promise.resolve()
    expect(document.activeElement).toBe(outside)
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

  it('moves the focus into the container on activation', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    expect(container).not.toBeNull()
    if (!container) return
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    active.value = true
    await nextTick()

    expect(document.activeElement).toBe(container)
  })

  it('keeps the focus on a child that is focused before activation', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    if (!container) return
    const button = container.querySelector('button')
    if (!button) return
    button.focus()

    active.value = true
    await nextTick()

    expect(document.activeElement).toBe(button)
  })

  it('keeps shift-tab from leaking outside when the container itself is focused', async () => {
    const active = ref(false)
    buildTrap(() => active.value)
    await Promise.resolve()

    const container = document.body.querySelector('div')
    if (!container) return

    active.value = true
    await nextTick()
    container.focus()

    const shift = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    container.dispatchEvent(shift)

    expect(shift.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(container)
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
    await nextTick()
    active.value = false
    await nextTick()

    expect(document.activeElement).toBe(outside)
  })
})

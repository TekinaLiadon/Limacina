import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore } from '../notificationStore'

describe('useNotificationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a message and hides it after the duration', () => {
    const store = useNotificationStore()
    store.show('Готово', 3000)
    expect(store.visible).toBe(true)
    expect(store.message).toBe('Готово')
    vi.advanceTimersByTime(2999)
    expect(store.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.visible).toBe(false)
  })

  it('uses the default duration of three seconds', () => {
    const store = useNotificationStore()
    store.show('Готово')
    vi.advanceTimersByTime(2999)
    expect(store.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.visible).toBe(false)
  })

  it('replaces a pending timer when a new message arrives', () => {
    const store = useNotificationStore()
    store.show('Первая', 1000)
    store.show('Вторая', 5000)
    vi.advanceTimersByTime(1000)
    expect(store.visible).toBe(true)
    expect(store.message).toBe('Вторая')
    vi.advanceTimersByTime(4000)
    expect(store.visible).toBe(false)
  })

  it('hide cancels the pending timer', () => {
    const store = useNotificationStore()
    store.show('Готово')
    store.hide()
    vi.advanceTimersByTime(10_000)
    expect(store.visible).toBe(false)
  })

  it('clears the timer id after the notification expires', () => {
    const store = useNotificationStore()
    store.show('Готово')
    expect(store.timer).not.toBeNull()
    vi.advanceTimersByTime(3000)
    expect(store.visible).toBe(false)
    expect(store.timer).toBeNull()
  })

  it('confirm shows the popup and resolves with the answer', async () => {
    const store = useNotificationStore()
    const promise = store.confirm('Удалить?')
    expect(store.popupVisible).toBe(true)
    expect(store.popupMessage).toBe('Удалить?')
    store.resolvePopup(true)
    await expect(promise).resolves.toBe(true)
    expect(store.popupVisible).toBe(false)
    expect(store.popupMessage).toBe('')
    expect(store.popupResolve).toBeNull()
  })

  it('resolves the previous popup as false when a new confirm arrives', async () => {
    const store = useNotificationStore()
    const first = store.confirm('Первый')
    const second = store.confirm('Второй')
    await expect(first).resolves.toBe(false)
    expect(store.popupMessage).toBe('Второй')
    store.resolvePopup(true)
    await expect(second).resolves.toBe(true)
  })

  it('resolvePopup without a pending popup only resets the state', () => {
    const store = useNotificationStore()
    expect(() => store.resolvePopup(true)).not.toThrow()
    expect(store.popupVisible).toBe(false)
    expect(store.popupResolve).toBeNull()
  })

  it('runConfirmed performs the action after confirmation', async () => {
    const store = useNotificationStore()
    const action = vi.fn()

    const pending = store.runConfirmed('Удалить?', action)
    store.resolvePopup(true)
    await pending

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('runConfirmed skips the action when the confirmation is declined', async () => {
    const store = useNotificationStore()
    const action = vi.fn()

    const pending = store.runConfirmed('Удалить?', action)
    store.resolvePopup(false)
    await pending

    expect(action).not.toHaveBeenCalled()
  })

  it('runConfirmed propagates the action failure', async () => {
    const store = useNotificationStore()
    const action = vi.fn(async (): Promise<void> => {
      throw new Error('boom')
    })

    const pending = store.runConfirmed('Удалить?', action)
    store.resolvePopup(true)
    await expect(pending).rejects.toThrow('boom')
  })
})

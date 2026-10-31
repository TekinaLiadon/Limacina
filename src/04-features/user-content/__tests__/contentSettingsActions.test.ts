import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createConfirmedContentActions, createTextureErrorSetter } from '../contentSettingsActions'

interface FakeNotification {
  runConfirmed: (text: string, action: () => Promise<void> | void) => Promise<void>
  resolveWith: (value: boolean) => void
}

const makeNotification = (): FakeNotification => {
  let confirmed = true
  return {
    resolveWith: (value: boolean): void => {
      confirmed = value
    },
    runConfirmed: vi.fn(async (_text: string, action: () => Promise<void> | void): Promise<void> => {
      if (!confirmed) return
      await action()
    }),
  }
}

const makeTexts = () => ({
  reset: 'Сбросить текущий скин?',
  delete: 'Удалить скин из списка загруженных?',
})

describe('createTextureErrorSetter', () => {
  it('sets the texture error into the target ref', () => {
    const target = ref('')
    const setTextureError = createTextureErrorSetter(target, 'Не удалось загрузить текстуру скина')

    setTextureError()

    expect(target.value).toBe('Не удалось загрузить текстуру скина')
  })
})

describe('createConfirmedContentActions', () => {
  it('runs the reset action only after confirmation', async () => {
    const notification = makeNotification()
    const reset = vi.fn()
    const actions = createConfirmedContentActions(notification, { handleDelete: vi.fn() }, makeTexts())

    await actions.runReset(reset)

    expect(notification.runConfirmed).toHaveBeenCalledWith('Сбросить текущий скин?', expect.any(Function))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('skips the reset when the dialog is declined', async () => {
    const notification = makeNotification()
    notification.resolveWith(false)
    const reset = vi.fn()
    const actions = createConfirmedContentActions(notification, { handleDelete: vi.fn() }, makeTexts())

    await actions.runReset(reset)

    expect(reset).not.toHaveBeenCalled()
  })

  it('deletes the item and runs the follow-up after confirmation', async () => {
    const notification = makeNotification()
    const handleDelete = vi.fn(async (): Promise<void> => {})
    const afterDelete = vi.fn(async (): Promise<void> => {})
    const actions = createConfirmedContentActions(notification, { handleDelete }, makeTexts())

    await actions.runDelete(7, afterDelete)

    expect(notification.runConfirmed).toHaveBeenCalledWith('Удалить скин из списка загруженных?', expect.any(Function))
    expect(handleDelete).toHaveBeenCalledWith(7)
    expect(afterDelete).toHaveBeenCalledTimes(1)
  })

  it('deletes the item without a follow-up action', async () => {
    const notification = makeNotification()
    const handleDelete = vi.fn(async (): Promise<void> => {})
    const actions = createConfirmedContentActions(notification, { handleDelete }, makeTexts())

    await actions.runDelete(3)

    expect(handleDelete).toHaveBeenCalledWith(3)
  })

  it('skips the delete when the dialog is declined', async () => {
    const notification = makeNotification()
    notification.resolveWith(false)
    const handleDelete = vi.fn(async (): Promise<void> => {})
    const afterDelete = vi.fn(async (): Promise<void> => {})
    const actions = createConfirmedContentActions(notification, { handleDelete }, makeTexts())

    await actions.runDelete(3, afterDelete)

    expect(handleDelete).not.toHaveBeenCalled()
    expect(afterDelete).not.toHaveBeenCalled()
  })
})

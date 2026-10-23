import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LauncherBehavior from '../LauncherBehavior.vue'
import type { LauncherBehaviorForm } from '@/05-entities'

const makeForm = (downloadSpeedLimit: number | null = null): LauncherBehaviorForm => ({
  discordActivity: true,
  autoUpdate: true,
  keepOldConfigs: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: false,
  systemNotifications: true,
  debugMode: false,
  downloadSpeedLimit,
})

const mountBehavior = (form: LauncherBehaviorForm, speedLimitError = '') =>
  mount(LauncherBehavior, { props: { form, speedLimitError } })

const lastForm = (wrapper: ReturnType<typeof mount>): LauncherBehaviorForm | undefined => {
  const emissions = wrapper.emitted('update:form')
  return emissions?.[emissions.length - 1]?.[0] as LauncherBehaviorForm | undefined
}

describe('LauncherBehavior', () => {
  it('writes the typed download speed limit into the form as a number', async () => {
    const wrapper = mountBehavior(makeForm())

    await wrapper.find('input[type="number"]').setValue('256')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBe(256)
    wrapper.unmount()
  })

  it('clears the download speed limit to null', async () => {
    const wrapper = mountBehavior(makeForm(256))

    await wrapper.find('input[type="number"]').setValue('')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBeNull()
    wrapper.unmount()
  })

  it('keeps a fractional limit in the form for the save validation', async () => {
    const wrapper = mountBehavior(makeForm())

    await wrapper.find('input[type="number"]').setValue('12.5')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBe(12.5)
    wrapper.unmount()
  })

  it('shows the speed limit error and marks the field invalid', () => {
    const error = 'Ограничение скорости: целое число от 1 до 10000000 КБ/с'
    const wrapper = mountBehavior(makeForm(12.5), error)

    expect(wrapper.get('.launcher-behavior__speed-error').text()).toBe(error)
    expect(wrapper.get('input[type="number"]').attributes('aria-invalid')).toBe('true')
    wrapper.unmount()
  })

  it('hides the speed limit error for a valid limit', () => {
    const wrapper = mountBehavior(makeForm(256))

    expect(wrapper.find('.launcher-behavior__speed-error').exists()).toBe(false)
    expect(wrapper.get('input[type="number"]').attributes('aria-invalid')).toBeUndefined()
    wrapper.unmount()
  })
})

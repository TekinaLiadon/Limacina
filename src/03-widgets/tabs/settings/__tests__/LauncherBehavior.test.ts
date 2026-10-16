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

const lastForm = (wrapper: ReturnType<typeof mount>): LauncherBehaviorForm | undefined => {
  const emissions = wrapper.emitted('update:form')
  return emissions?.[emissions.length - 1]?.[0] as LauncherBehaviorForm | undefined
}

describe('LauncherBehavior', () => {
  it('writes the typed download speed limit into the form as a number', async () => {
    const wrapper = mount(LauncherBehavior, { props: { form: makeForm() } })

    await wrapper.find('input[type="number"]').setValue('256')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBe(256)
    wrapper.unmount()
  })

  it('clears the download speed limit to null', async () => {
    const wrapper = mount(LauncherBehavior, { props: { form: makeForm(256) } })

    await wrapper.find('input[type="number"]').setValue('')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBeNull()
    wrapper.unmount()
  })

  it('keeps a fractional limit in the form for the save validation', async () => {
    const wrapper = mount(LauncherBehavior, { props: { form: makeForm() } })

    await wrapper.find('input[type="number"]').setValue('12.5')

    expect(lastForm(wrapper)?.downloadSpeedLimit).toBe(12.5)
    wrapper.unmount()
  })
})

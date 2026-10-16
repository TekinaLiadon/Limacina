import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModrinthInstallActions from '../ModrinthInstallActions.vue'

type ActionsProps = {
  isInstalled: boolean
  updateVersion: string
  isBusy: boolean
  isBusyAny: boolean
}

const mountActions = (overrides: Partial<ActionsProps> = {}) =>
  mount(ModrinthInstallActions, {
    props: {
      isInstalled: false,
      updateVersion: '',
      isBusy: false,
      isBusyAny: false,
      ...overrides,
    } satisfies ActionsProps,
  })

describe('ModrinthInstallActions', () => {
  it('renders the install action for a mod that is not installed', async () => {
    const wrapper = mountActions()

    const button = wrapper.get('button')
    expect(button.text()).toBe('Скачать')

    await button.trigger('click')
    expect(wrapper.emitted('install')).toHaveLength(1)
    expect(wrapper.emitted('update')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders the update action when an update is available', async () => {
    const wrapper = mountActions({ isInstalled: true, updateVersion: '2.0.0' })

    const button = wrapper.get('button')
    expect(button.text()).toBe('Обновить')

    await button.trigger('click')
    expect(wrapper.emitted('update')).toHaveLength(1)
    expect(wrapper.emitted('install')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders the installed badge instead of buttons', () => {
    const wrapper = mountActions({ isInstalled: true })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('.modrinth-install-actions__badge').text()).toBe('Установлен')
    wrapper.unmount()
  })

  it('disables the action while any other action is running', () => {
    const wrapper = mountActions({ isBusyAny: true })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('marks the running action as loading', () => {
    const wrapper = mountActions({ isInstalled: true, updateVersion: '2.0.0', isBusy: true })

    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.classes()).toContain('loading')
    wrapper.unmount()
  })
})

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuthTabsWidget from '../AuthTabsWidget.vue'
import { AUTH_LOGIN_TAB, useCoreStore, type ProjectConfig } from '@/05-entities'

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'Alpha',
  mcVersion: '1.21.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512M',
  maxMemory: '2048M',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

const mountWidget = () =>
  mount(AuthTabsWidget, {
    props: { activeTab: AUTH_LOGIN_TAB },
  })

describe('AuthTabsWidget', () => {
  it('shows the save-data checkbox for an offline project', () => {
    setActivePinia(createPinia())
    useCoreStore().projectConfig = makeProjectConfig(false)

    const wrapper = mountWidget()

    expect(wrapper.find('.checkbox').exists()).toBe(true)
    expect(wrapper.find('.checkbox__label').text()).toBe('Сохранить данные')
    expect(wrapper.text()).not.toContain('Регистрация')

    wrapper.unmount()
  })

  it('shows the save-data checkbox for an online project', () => {
    setActivePinia(createPinia())
    useCoreStore().projectConfig = makeProjectConfig(true)

    const wrapper = mountWidget()

    expect(wrapper.find('.checkbox').exists()).toBe(true)

    wrapper.unmount()
  })
})

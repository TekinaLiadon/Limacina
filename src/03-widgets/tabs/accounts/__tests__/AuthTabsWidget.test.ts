import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import AuthTabsWidget from '../AuthTabsWidget.vue'
import { AUTH_LOGIN_TAB, useCoreStore } from '@/05-entities'
import { makeProjectConfig } from '@/test-support/fixtures'

const prepareProject = (online: boolean): void => {
  setActivePinia(createPinia())
  useCoreStore().projectConfig = makeProjectConfig({ projectName: 'Alpha', mcVersion: '1.21.1', minMemory: '512M', maxMemory: '2048M', online })
}

const mountWidget = (attach = false) => {
  const options = attach
    ? { props: { activeTab: AUTH_LOGIN_TAB }, attachTo: document.body }
    : { props: { activeTab: AUTH_LOGIN_TAB } }
  return mount(AuthTabsWidget, options)
}

describe('AuthTabsWidget', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('shows the save-data checkbox for an offline project', () => {
    prepareProject(false)
    const wrapper = mountWidget()

    expect(wrapper.find('.checkbox').exists()).toBe(true)
    expect(wrapper.find('.checkbox__label').text()).toBe('Сохранить данные')
    expect(wrapper.text()).not.toContain('Регистрация')

    wrapper.unmount()
  })

  it('shows the save-data checkbox for an online project', () => {
    prepareProject(true)
    const wrapper = mountWidget()

    expect(wrapper.find('.checkbox').exists()).toBe(true)

    wrapper.unmount()
  })

  it('exposes the auth switcher as a tablist with a roving tabindex and a labelled panel', () => {
    prepareProject(true)
    const wrapper = mountWidget(true)

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.attributes('aria-label')).toBe('Авторизация')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(tabs[0]?.attributes('tabindex')).toBe('0')
    expect(tabs[1]?.attributes('aria-selected')).toBe('false')
    expect(tabs[1]?.attributes('tabindex')).toBe('-1')

    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('aria-labelledby')).toBe(tabs[0]?.attributes('id'))

    wrapper.unmount()
  })

  it('moves roving focus with arrows and switches the auth tab along with it', async () => {
    prepareProject(true)
    const wrapper = mount({
      components: { AuthTabsWidget },
      setup: () => ({ tab: ref<string>(AUTH_LOGIN_TAB) }),
      template: '<AuthTabsWidget v-model:active-tab="tab" />',
    }, { attachTo: document.body })

    const loginTab = wrapper.get('#auth-tab-login')
    ;(loginTab.element as HTMLElement).focus()

    await loginTab.trigger('keydown', { key: 'ArrowRight' })

    expect(document.activeElement?.id).toBe('auth-tab-register')
    expect(wrapper.get('#auth-tab-register').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#auth-tab-register').attributes('tabindex')).toBe('0')
    expect(wrapper.get('#auth-tab-login').attributes('aria-selected')).toBe('false')

    wrapper.unmount()
  })
})

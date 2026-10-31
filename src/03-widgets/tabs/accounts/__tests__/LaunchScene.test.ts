import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LaunchScene from '../LaunchScene.vue'

type LaunchSceneProps = InstanceType<typeof LaunchScene>['$props']

const mountScene = (overrides: Partial<LaunchSceneProps> = {}) =>
  mount(LaunchScene, {
    props: {
      activeTab: 'login',
      username: 'alice',
      selectedUsername: 'alice',
      hasSession: true,
      logins: ['alice'],
      isLoading: false,
      isLaunching: false,
      isCancelPending: false,
      progress: 0,
      steps: [],
      sessionUsernames: [],
      showAuth: false,
      showBack: true,
      ...overrides,
    },
    global: {
      stubs: {
        AuthTabsWidget: true,
        Identicon: true,
        LaunchSessionScene: true,
        LaunchProgressScene: true,
        LaunchActionsScene: true,
      },
    },
  })

describe('LaunchScene', () => {
  it('shows the select error while the launcher is idle', () => {
    const wrapper = mountScene({ selectError: 'Нет сохранённых учётных данных' })

    expect(wrapper.find('.launch-scene__error').text()).toBe('Нет сохранённых учётных данных')

    wrapper.unmount()
  })

  it('hides the stale select error during the launch progress', () => {
    const wrapper = mountScene({ selectError: 'Нет сохранённых учётных данных', isLaunching: true })

    expect(wrapper.find('.launch-scene__error').exists()).toBe(false)

    wrapper.unmount()
  })
})

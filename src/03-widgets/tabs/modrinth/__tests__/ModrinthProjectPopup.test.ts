import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModrinthProjectPopup from '../ModrinthProjectPopup.vue'
import type { ModrinthProjectDetails, ModrinthSearchHit } from '@/05-entities'

const makeHit = (): ModrinthSearchHit => ({
  project_id: 'p-1',
  project_type: 'mod',
  slug: null,
  author: null,
  title: 'Sodium',
  description: 'Быстрый рендер',
  categories: [],
  downloads: 10,
  follows: 5,
  icon_url: null,
  date_created: null,
  date_modified: null,
  latest_version: null,
  license: null,
  client_side: null,
  server_side: null,
})

const makeDetails = (): ModrinthProjectDetails => ({
  project: {
    id: 'p-1',
    slug: null,
    project_type: 'mod',
    title: 'Sodium',
    description: 'Быстрый рендер',
    body: '',
    categories: [],
    downloads: 10,
    follows: 5,
    icon_url: null,
    date_created: null,
    date_modified: null,
    license: null,
    client_side: null,
    server_side: null,
    source_url: null,
    issues_url: null,
    wiki_url: null,
    discord_url: null,
  },
  versions: [
    {
      id: 'v-1',
      project_id: 'p-1',
      name: 'Sodium 1.0',
      version_number: '1.0',
      changelog: 'Исправлена утечка памяти',
      dependencies: [],
      game_versions: ['1.20.1'],
      loaders: ['fabric'],
      version_type: 'release',
      date_published: null,
      downloads: 10,
      featured: false,
      files: [],
    },
    {
      id: 'v-2',
      project_id: 'p-1',
      name: 'Sodium 0.9',
      version_number: '0.9',
      changelog: null,
      dependencies: [],
      game_versions: ['1.20.1'],
      loaders: ['fabric'],
      version_type: 'beta',
      date_published: null,
      downloads: 5,
      featured: false,
      files: [],
    },
  ],
  versions_failed: false,
})

type PopupOverrides = Partial<{ isBusyAny: boolean; actionError: string }>

const mountPopup = (visible: boolean, overrides: PopupOverrides = {}) =>
  mount(ModrinthProjectPopup, {
    props: {
      visible,
      hit: makeHit(),
      details: makeDetails(),
      isLoading: false,
      loadError: '',
      isInstalled: false,
      updateVersion: '',
      isBusy: false,
      isBusyAny: false,
      actionError: '',
      ...overrides,
    },
    global: { stubs: { teleport: true } },
  })

describe('ModrinthProjectPopup', () => {
  beforeEach((): void => {
    setActivePinia(createPinia())
  })

  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('collapses the expanded changelog when the same project popup reopens', async () => {
    const wrapper = mountPopup(true)
    const toggle = wrapper.findAll('button').find((button) => button.text() === 'Изменения')
    expect(toggle).toBeDefined()

    await toggle?.trigger('click')
    expect(wrapper.text()).toContain('Скрыть изменения')

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })

    expect(wrapper.findAll('button').some((button) => button.text() === 'Изменения')).toBe(true)
    expect(wrapper.text()).not.toContain('Скрыть изменения')

    wrapper.unmount()
  })

  it('offers an install action per version and emits its id', async () => {
    const wrapper = mountPopup(true)
    const installButtons = wrapper.findAll('button').filter((button) => button.text() === 'Установить')
    expect(installButtons).toHaveLength(2)

    await installButtons[1]?.trigger('click')

    expect(wrapper.emitted('install-version')).toEqual([['v-2']])

    wrapper.unmount()
  })

  it('disables version installs while any install runs and shows the action error', async () => {
    const wrapper = mountPopup(true, { isBusyAny: true })

    const installButtons = wrapper.findAll('button').filter((button) => button.text() === 'Установить')
    expect(installButtons).toHaveLength(2)
    for (const button of installButtons) {
      expect(button.attributes('disabled')).toBeDefined()
    }

    await wrapper.setProps({ isBusyAny: false, actionError: 'Версия несовместима с профилем' })
    expect(wrapper.text()).toContain('Версия несовместима с профилем')
    expect(wrapper.find('.modrinth-popup__action-error').exists()).toBe(true)

    wrapper.unmount()
  })
})

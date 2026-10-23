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
  ],
  versions_failed: false,
})

const mountPopup = (visible: boolean) =>
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
})

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Dropdown } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities'
import AlternativeJavaPopup from '../AlternativeJavaPopup.vue'

const makeDistributions = (names: string[]): JavaDistribution[] =>
  names.map((name) => ({ name, apiParameter: `api-${name}` }))

const megabyte = 1024 * 1024

const mountPopup = (distributions: JavaDistribution[], overrides: Record<string, unknown> = {}) =>
  mount(AlternativeJavaPopup, {
    props: {
      visible: true,
      distributions,
      isDownloading: false,
      isDistributionsLoading: false,
      distributionsError: '',
      versionError: '',
      ...overrides,
    },
    attachTo: document.body,
  })

describe('AlternativeJavaPopup', () => {
  it('maps distributions to dropdown options and follows prop updates', async () => {
    const wrapper = mountPopup(makeDistributions(['Adoptium', 'Azul']))

    const options = (): unknown => wrapper.getComponent(Dropdown).props('options')
    expect(options()).toEqual([
      { title: 'Adoptium', value: 'Adoptium' },
      { title: 'Azul', value: 'Azul' },
    ])

    await wrapper.setProps({ distributions: makeDistributions(['BellSoft']) })
    expect(options()).toEqual([{ title: 'BellSoft', value: 'BellSoft' }])

    wrapper.unmount()
  })

  it('shows the progress bar with percentages while downloading a known total', async () => {
    const wrapper = mountPopup([], {
      isDownloading: true,
      downloaded: 2.5 * megabyte,
      total: 10 * megabyte,
    })
    await wrapper.vm.$nextTick()

    const bar = document.body.querySelector('.progress-bar')
    expect(bar).not.toBeNull()
    expect(bar?.querySelector('.progress-bar__fill')).not.toBeNull()
    expect(bar?.textContent).toContain('25%')
    expect(bar?.getAttribute('aria-label')).toBe('Прогресс загрузки Java')
    expect(document.body.querySelector('.preloader')).toBeNull()
    expect(document.body.querySelector('.alt-java-popup__downloaded')).toBeNull()

    wrapper.unmount()
  })

  it('shows the downloaded bytes label without percentages when the total is unknown', async () => {
    const wrapper = mountPopup([], {
      isDownloading: true,
      downloaded: 1.5 * megabyte,
      total: 0,
    })
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.progress-bar')).toBeNull()
    expect(document.body.querySelector('.preloader')).not.toBeNull()
    expect(document.body.querySelector('.alt-java-popup__downloaded')?.textContent).toBe('Скачано: 1.5 МБ')

    wrapper.unmount()
  })

  it('shows the unpacking text instead of progress in the extract phase', async () => {
    const wrapper = mountPopup([], {
      isDownloading: true,
      downloaded: 10 * megabyte,
      total: 10 * megabyte,
      phase: 'extract',
    })
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.alt-java-popup__phase')?.textContent).toContain('Распаковка')
    expect(document.body.querySelector('.progress-bar')).toBeNull()
    expect(document.body.querySelector('.preloader')).toBeNull()
    expect(document.body.querySelector('.alt-java-popup__downloaded')).toBeNull()

    wrapper.unmount()
  })

  it('emits cancel from the cancel button while downloading', async () => {
    const wrapper = mountPopup([], { isDownloading: true })
    await wrapper.vm.$nextTick()

    document.body.querySelector<HTMLElement>('.alt-java-popup__btn')?.click()

    expect(wrapper.emitted('cancel')).toHaveLength(1)

    wrapper.unmount()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ProjectJava from '../ProjectJava.vue'
import AlternativeJavaButton from '../../AlternativeJavaButton.vue'

const openPopup = vi.fn().mockResolvedValue(undefined)
const closePopup = vi.fn()
const startDownload = vi.fn().mockResolvedValue(false)
const isPopupOpen = ref(false)

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useAlternativeJava: () => ({
      distributions: ref([]),
      selectedDistribution: ref(''),
      javaVersion: ref(''),
      replaceDefault: ref(false),
      isDownloading: ref(false),
      isPopupOpen,
      isDistributionsLoading: ref(false),
      distributionsError: ref(''),
      versionError: ref(''),
      openPopup,
      closePopup,
      startDownload,
    }),
  }
})

const mountJava = (props: Record<string, unknown> = {}) =>
  mount(ProjectJava, {
    props: {
      javaPath: '/usr/lib/jvm/java-21',
      mcVersion: '1.20.1',
      ...props,
    },
  })

beforeEach((): void => {
  openPopup.mockClear()
  closePopup.mockClear()
  startDownload.mockClear()
  startDownload.mockResolvedValue(false)
})

describe('ProjectJava', () => {
  it('shows the configured java path and asks the page to browse', async () => {
    const wrapper = mountJava()

    expect((wrapper.find('input.input__text').element as HTMLInputElement).value).toBe('/usr/lib/jvm/java-21')

    await wrapper.find('.path-picker__browse-btn').trigger('click')

    expect(wrapper.emitted('browse')).toHaveLength(1)
  })

  it('opens the alternative java popup for the current minecraft version', async () => {
    const wrapper = mountJava()

    await wrapper.find('.alt-java-button__btn').trigger('click')

    expect(openPopup).toHaveBeenCalledWith('1.20.1')
  })

  it('closes the popup through the alternative java button', async () => {
    const wrapper = mountJava()

    wrapper.findComponent(AlternativeJavaButton).vm.$emit('close-popup')
    await flushPromises()

    expect(closePopup).toHaveBeenCalled()
  })

  it('asks the page to reload the config when the download replaced the default java', async () => {
    startDownload.mockResolvedValue(true)
    const wrapper = mountJava()

    wrapper.findComponent(AlternativeJavaButton).vm.$emit('download')
    await flushPromises()

    expect(wrapper.emitted('java-replaced')).toHaveLength(1)
  })

  it('stays quiet when the download did not replace the default java', async () => {
    const wrapper = mountJava()

    wrapper.findComponent(AlternativeJavaButton).vm.$emit('download')
    await flushPromises()

    expect(wrapper.emitted('java-replaced')).toBeUndefined()
  })
})

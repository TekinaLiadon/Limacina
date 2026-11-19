import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ProjectJava from '../ProjectJava.vue'
import AlternativeJavaButton from '../../AlternativeJavaButton.vue'
import AlternativeJavaPopup from '../../AlternativeJavaPopup.vue'

const openPopup = vi.fn().mockResolvedValue(undefined)
const closePopup = vi.fn()
const startDownload = vi.fn().mockResolvedValue('downloaded')
const cancelDownload = vi.fn()
const isPopupOpen = ref(false)
const isDownloading = ref(false)
const downloaded = ref(0)
const total = ref(0)
const phase = ref<'download' | 'extract'>('download')

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useAlternativeJava: () => ({
      distributions: ref([]),
      selectedDistribution: ref(''),
      javaVersion: ref(''),
      replaceDefault: ref(false),
      isDownloading,
      isPopupOpen,
      isDistributionsLoading: ref(false),
      distributionsError: ref(''),
      versionError: ref(''),
      downloaded,
      total,
      phase,
      openPopup,
      closePopup,
      cancelDownload,
      startDownload,
    }),
  }
})

const mountJava = (props: Record<string, unknown> = {}) =>
  mount(ProjectJava, {
    props: {
      javaPath: '/usr/lib/jvm/java-21/bin/java',
      mcVersion: '1.20.1',
      ...props,
    },
  })

beforeEach((): void => {
  openPopup.mockClear()
  closePopup.mockClear()
  startDownload.mockClear()
  startDownload.mockResolvedValue('downloaded')
  cancelDownload.mockClear()
  isPopupOpen.value = false
  isDownloading.value = false
  downloaded.value = 0
  total.value = 0
  phase.value = 'download'
})

describe('ProjectJava', () => {
  it('shows the configured java path and asks the page to browse', async () => {
    const wrapper = mountJava()

    expect((wrapper.find('input.input__text').element as HTMLInputElement).value).toBe('/usr/lib/jvm/java-21/bin/java')

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
    startDownload.mockResolvedValue('replaced')
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

  it('forwards download progress to the alternative java popup', async () => {
    isDownloading.value = true
    isPopupOpen.value = true
    downloaded.value = 3145728
    total.value = 10485760
    const wrapper = mountJava()

    const popup = wrapper.findComponent(AlternativeJavaPopup)
    expect(popup.props('isDownloading')).toBe(true)
    expect(popup.props('downloaded')).toBe(3145728)
    expect(popup.props('total')).toBe(10485760)
    expect(popup.props('phase')).toBe('download')

    wrapper.unmount()
  })

  it('forwards the extract phase to the alternative java popup', async () => {
    isDownloading.value = true
    isPopupOpen.value = true
    phase.value = 'extract'
    const wrapper = mountJava()

    expect(wrapper.findComponent(AlternativeJavaPopup).props('phase')).toBe('extract')

    wrapper.unmount()
  })

  it('routes the popup cancel event to cancelDownload', async () => {
    const wrapper = mountJava()

    wrapper.findComponent(AlternativeJavaPopup).vm.$emit('cancel')
    await flushPromises()

    expect(cancelDownload).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})

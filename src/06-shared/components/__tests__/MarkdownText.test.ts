import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import MarkdownText from '../MarkdownText.vue'

const openExternalUrl = vi.hoisted(() => vi.fn(async (): Promise<void> => {}))

vi.mock('@/06-shared/utils/externalUrl', () => ({
  openExternalUrl,
}))

const BASE_URL = 'https://modrinth.com/mod/x'

const mountText = (source: string): ReturnType<typeof mount> =>
  mount(MarkdownText, { props: { source, baseUrl: BASE_URL } })

const clickAnchor = async (element: Element): Promise<void> => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  element.dispatchEvent(event)
  await vi.waitFor(() => expect(preventDefault).toHaveBeenCalled())
}

describe('MarkdownText', () => {
  beforeEach(() => {
    openExternalUrl.mockClear()
    openExternalUrl.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders markdown into html', () => {
    const wrapper = mountText('# Заголовок\n\nабзац с **жирным**')

    expect(wrapper.find('h1').text()).toBe('Заголовок')
    expect(wrapper.find('strong').text()).toBe('жирным')
    wrapper.unmount()
  })

  it('strips scripts and inline handlers from the source', () => {
    const wrapper = mountText(
      'до <script>alert(1)</script> после\n\n<img src="cover.png" onerror="alert(1)">',
    )

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('img').attributes('onerror')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders a javascript: link without href and never opens it', async () => {
    const wrapper = mountText('[тык](javascript:alert(1))')

    const anchor = wrapper.find('a')
    expect(anchor.exists()).toBe(true)
    expect(anchor.attributes('href')).toBeUndefined()

    await anchor.trigger('click')
    await nextTick()

    expect(openExternalUrl).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens an absolute link in the external browser', async () => {
    const wrapper = mountText('[сайт](https://example.ru/page)')

    await clickAnchor(wrapper.find('a').element)

    expect(openExternalUrl).toHaveBeenCalledOnce()
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.ru/page')
    wrapper.unmount()
  })

  it('resolves a relative link against the base url before opening', async () => {
    const wrapper = mountText('[инструкция](docs/readme.md)')

    await clickAnchor(wrapper.find('a').element)

    expect(openExternalUrl).toHaveBeenCalledWith('https://modrinth.com/mod/docs/readme.md')
    wrapper.unmount()
  })

  it('opens a link clicked on a nested element', async () => {
    const wrapper = mountText('[**жирная ссылка**](https://example.ru)')

    await clickAnchor(wrapper.find('strong').element)

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.ru/')
    wrapper.unmount()
  })

  it('ignores clicks outside anchors', async () => {
    const wrapper = mountText('просто текст')

    await wrapper.find('.markdown-text').trigger('click')
    await nextTick()

    expect(openExternalUrl).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('emits link-error when the url fails to open', async () => {
    openExternalUrl.mockRejectedValue(new Error('нет браузера'))
    const wrapper = mountText('[сайт](https://example.ru)')

    await clickAnchor(wrapper.find('a').element)
    await vi.waitFor(() => expect(wrapper.emitted('link-error')).toHaveLength(1))

    expect(wrapper.emitted('link-error')![0]).toEqual(['нет браузера'])
    wrapper.unmount()
  })
})

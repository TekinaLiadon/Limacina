import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Identicon from '../Identicon.vue'
import { generateIdenticon } from '@/06-shared'

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  generateIdenticon: vi.fn(),
}))

const mountIdenticon = () =>
  mount(Identicon, {
    props: { username: 'steve', size: 32 },
  })

describe('Identicon', () => {
  beforeEach(() => {
    vi.mocked(generateIdenticon).mockReset()
  })

  it('renders the generated image with the requested size', () => {
    vi.mocked(generateIdenticon).mockReturnValue('data:image/png;base64,abc')
    const wrapper = mountIdenticon()

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,abc')
    expect(img.attributes('style')).toContain('width: 32px')

    wrapper.unmount()
  })

  it('renders nothing when the identicon cannot be generated', () => {
    vi.mocked(generateIdenticon).mockReturnValue('')
    const wrapper = mountIdenticon()

    expect(wrapper.find('img').exists()).toBe(false)

    wrapper.unmount()
  })
})

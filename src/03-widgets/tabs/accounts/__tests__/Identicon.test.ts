import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Identicon from '../Identicon.vue'
import { generateIdenticon } from '@/06-shared'

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  generateIdenticon: vi.fn(),
}))

const mountIdenticon = (size: 'sm' | 'lg') =>
  mount(Identicon, {
    props: { username: 'steve', size },
  })

describe('Identicon', () => {
  beforeEach(() => {
    vi.mocked(generateIdenticon).mockReset()
  })

  it('renders the generated image with the size modifier class', () => {
    vi.mocked(generateIdenticon).mockReturnValue('data:image/png;base64,abc')
    const wrapper = mountIdenticon('lg')

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,abc')
    expect(img.classes()).toContain('identicon--lg')
    expect(img.attributes('style')).toBeUndefined()

    wrapper.unmount()
  })

  it('renders nothing when the identicon cannot be generated', () => {
    vi.mocked(generateIdenticon).mockReturnValue('')
    const wrapper = mountIdenticon('sm')

    expect(wrapper.find('img').exists()).toBe(false)

    wrapper.unmount()
  })
})

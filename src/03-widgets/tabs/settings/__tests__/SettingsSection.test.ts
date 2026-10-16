import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import SettingsSection from '../SettingsSection.vue'

const source = readFileSync(join(process.cwd(), 'src/03-widgets/tabs/settings/SettingsSection.vue'), 'utf-8')

const block = (selector: string): string => {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Блок ${selector} не найден в SettingsSection.vue`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  throw new Error(`Блок ${selector} не закрыт`)
}

const mountSection = (storageKey = '') =>
  mount(SettingsSection, {
    props: { title: 'Чат', storageKey },
    slots: { default: '<div class="settings-section__probe">Поля</div>' },
  })

describe('SettingsSection', () => {
  afterEach((): void => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('collapses and expands the body through the head button', async () => {
    const wrapper = mountSection('game-chat')

    const head = wrapper.find('.settings-section__head')
    expect(head.attributes('aria-expanded')).toBe('true')

    await head.trigger('click')
    expect(head.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.settings-section__body').classes()).toContain('settings-section__body--closed')
    expect(wrapper.find('.settings-section__inner').classes()).toContain('settings-section__inner--clip')
    expect(localStorage.getItem('limacina-section-game-chat')).toBe('0')

    await head.trigger('click')
    expect(head.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.settings-section__body').classes()).not.toContain('settings-section__body--closed')
    expect(localStorage.getItem('limacina-section-game-chat')).toBe('1')

    wrapper.unmount()
  })

  it('restores the collapsed state and keeps the body clipped while the animation runs', async () => {
    localStorage.setItem('limacina-section-game-chat', '0')
    vi.useFakeTimers()
    const wrapper = mountSection('game-chat')
    await nextTick()

    expect(wrapper.find('.settings-section__head').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.settings-section__inner').classes()).toContain('settings-section__inner--clip')

    await wrapper.find('.settings-section__head').trigger('click')
    expect(wrapper.find('.settings-section__inner').classes()).toContain('settings-section__inner--clip')

    vi.advanceTimersByTime(400)
    await nextTick()
    expect(wrapper.find('.settings-section__inner').classes()).not.toContain('settings-section__inner--clip')

    wrapper.unmount()
  })

  it('renders a plain title without a toggle when no storage key is given', () => {
    const wrapper = mountSection()

    expect(wrapper.find('.settings-section__head').exists()).toBe(false)
    expect(wrapper.find('.settings-section__body').classes()).not.toContain('settings-section__body--closed')
    expect(wrapper.find('.settings-section__probe').exists()).toBe(true)

    wrapper.unmount()
  })

  it('resets min-height only while the body is clipped so WebKit does not keep a stale track height', () => {
    const inner = block('&__inner')
    const [base = '', clip = ''] = inner.split('&--clip')
    const clipBody = clip.slice(0, clip.indexOf('}'))

    expect(base).not.toContain('min-height')
    expect(clipBody).toContain('min-height: 0')
    expect(clipBody).toContain('overflow: hidden')
  })
})

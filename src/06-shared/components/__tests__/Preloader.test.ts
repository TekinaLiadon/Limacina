import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Preloader from '../Preloader.vue'

describe('Preloader', () => {
  it('announces the loading text as a polite status region', () => {
    const wrapper = mount(Preloader, { props: { text: 'Загрузка скина...' } })
    const root = wrapper.find('.preloader')

    expect(root.attributes('role')).toBe('status')
    expect(root.attributes('aria-live')).toBe('polite')
    expect(root.find('.preloader__text').text()).toBe('Загрузка скина...')

    wrapper.unmount()
  })

  it('keeps the default loading text and the local modifier', () => {
    const wrapper = mount(Preloader, { props: { local: true } })

    expect(wrapper.find('.preloader--local').exists()).toBe(true)
    expect(wrapper.find('.preloader__text').text()).toBe('Получение данных')

    wrapper.unmount()
  })
})

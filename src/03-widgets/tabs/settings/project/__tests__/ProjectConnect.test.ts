import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectConnect from '../ProjectConnect.vue'

const mountConnect = (props: Record<string, unknown> = {}) =>
  mount(ProjectConnect, {
    props: {
      url: '',
      isLoading: false,
      ...props,
    },
  })

describe('ProjectConnect', () => {
  it('asks the page for the connect url', async () => {
    const wrapper = mountConnect()

    await wrapper.find('.server-connect__btn').trigger('click')

    expect(wrapper.emitted('get')).toHaveLength(1)
  })

  it('renders the url with a copy action once it is loaded', async () => {
    const wrapper = mountConnect({ url: 'limacina://connect?host=example' })

    expect(wrapper.find('.server-connect__url').text()).toBe('limacina://connect?host=example')

    await wrapper.find('.server-connect__copy').trigger('click')

    expect(wrapper.emitted('copy')).toHaveLength(1)
  })

  it('blocks the request while the url is loading', () => {
    const wrapper = mountConnect({ isLoading: true })

    expect(wrapper.find('.server-connect__btn').attributes('disabled')).toBeDefined()
  })
})

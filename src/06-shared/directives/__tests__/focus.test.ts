import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, withDirectives } from 'vue'
import { mount } from '@vue/test-utils'
import { vFocus } from '../focus'

const mountDirected = (render: () => ReturnType<typeof h>): ReturnType<typeof mount> =>
  mount(
    defineComponent({
      setup: () => render,
    }),
    { attachTo: document.body },
  )

describe('vFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the host element on mount', () => {
    const wrapper = mountDirected(() => withDirectives(h('button', { class: 'host' }, 'ok'), [[vFocus]]))

    expect(document.activeElement).toBe(wrapper.element)
    wrapper.unmount()
  })
})

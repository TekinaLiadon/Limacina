import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectDanger from '../ProjectDanger.vue'

const mountDanger = (props: Record<string, unknown> = {}) =>
  mount(ProjectDanger, {
    props: {
      canDelete: true,
      isClearing: false,
      isDeleting: false,
      ...props,
    },
  })

describe('ProjectDanger', () => {
  it('emits the clear action', async () => {
    const wrapper = mountDanger()

    await wrapper.find('.btn-danger').trigger('click')

    expect(wrapper.emitted('clear-config')).toHaveLength(1)
  })

  it('emits the delete action', async () => {
    const wrapper = mountDanger()

    await wrapper.find('.project-danger__button').trigger('click')

    expect(wrapper.emitted('delete-project')).toHaveLength(1)
  })

  it('hides the delete button when the project is pinned by the build', () => {
    const wrapper = mountDanger({ canDelete: false })

    expect(wrapper.find('.project-danger__button').exists()).toBe(false)
    expect(wrapper.findAll('.btn-danger')).toHaveLength(1)
  })

  it('disables both actions while they run', () => {
    const wrapper = mountDanger({ isClearing: true, isDeleting: true })

    for (const button of wrapper.findAll('.btn-danger')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })
})

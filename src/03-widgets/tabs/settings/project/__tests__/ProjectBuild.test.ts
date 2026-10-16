import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectBuild from '../ProjectBuild.vue'

const mountBuild = (props: Record<string, unknown> = {}) =>
  mount(ProjectBuild, {
    props: {
      mcVersion: '1.20.1',
      modLoader: 'fabric',
      loaderVersion: '0.15.0',
      autoJoinServer: false,
      isRefreshing: false,
      isSaving: false,
      ...props,
    },
  })

describe('ProjectBuild', () => {
  it('renders the minecraft version and the loader label', () => {
    const wrapper = mountBuild()

    const rows = wrapper.findAll('.settings-info-row')
    expect(rows[0]?.text()).toContain('Версия Minecraft')
    expect(rows[0]?.text()).toContain('1.20.1')
    expect(rows[1]?.text()).toContain('Загрузчик модов')
    expect(rows[1]?.text()).toContain('Fabric')
  })

  it('emits the edited loader version', async () => {
    const wrapper = mountBuild()

    await wrapper.find('input.input__text').setValue('0.16.0')

    expect(wrapper.emitted('update:loaderVersion')).toEqual([['0.16.0']])
  })

  it('emits the autojoin flag when the checkbox toggles', async () => {
    const wrapper = mountBuild()

    await wrapper.find('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:autoJoinServer')).toEqual([[true]])
  })

  it('emits refresh from the manifests button', async () => {
    const wrapper = mountBuild()

    await wrapper.find('.project-build__refresh-btn').trigger('click')

    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('disables the manifests button while refreshing or saving', () => {
    expect(mountBuild({ isRefreshing: true }).find('.project-build__refresh-btn').attributes('disabled')).toBeDefined()
    expect(mountBuild({ isSaving: true }).find('.project-build__refresh-btn').attributes('disabled')).toBeDefined()
  })
})

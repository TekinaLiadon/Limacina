import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import JvmPreset from '../../JvmPreset.vue'
import ProjectRun from '../ProjectRun.vue'

const mountRun = (props: Record<string, unknown> = {}) =>
  mount(ProjectRun, {
    props: {
      javaVersion: 21,
      memoryRange: [512, 4096],
      jvmArgs: '',
      maxMemoryLimit: 8192,
      jvmArgsError: '',
      ...props,
    },
  })

describe('ProjectRun', () => {
  it('emits a new memory range from the slider', async () => {
    const wrapper = mountRun()

    await wrapper.find('input.memory-slider__input--max').setValue('2048')

    expect(wrapper.emitted('update:memoryRange')).toEqual([[[512, 2048]]])
  })

  it('emits the edited jvm arguments', async () => {
    const wrapper = mountRun()

    await wrapper.find('input.input__text').setValue('-XX:+UseG1GC')

    expect(wrapper.emitted('update:jvmArgs')).toEqual([['-XX:+UseG1GC']])
  })

  it('shows the jvm arguments error under the input', () => {
    const wrapper = mountRun({ jvmArgsError: 'Кавычки не поддерживаются' })

    expect(wrapper.find('.project-run__jvm-error').text()).toBe('Кавычки не поддерживаются')
    expect(mountRun().find('.project-run__jvm-error').exists()).toBe(false)
  })

  it('forwards an applied preset as new jvm arguments', () => {
    const wrapper = mountRun()

    const preset = wrapper.findComponent(JvmPreset)
    expect(preset.props('javaVersion')).toBe(21)

    preset.vm.$emit('update:jvmArgs', '-XX:+UseZGC')

    expect(wrapper.emitted('update:jvmArgs')).toEqual([['-XX:+UseZGC']])
  })
})

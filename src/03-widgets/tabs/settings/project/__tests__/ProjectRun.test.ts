import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Dropdown } from '@/06-shared'
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
      cpuCores: null,
      availableCpuCores: 8,
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

  it('renders the auto option followed by the machine core counts', () => {
    const wrapper = mountRun({ availableCpuCores: 4 })

    expect(wrapper.findComponent(Dropdown).props('options')).toEqual([
      { value: 'auto', title: 'Авто (JVM определит сама)' },
      { value: '1', title: '1' },
      { value: '2', title: '2' },
      { value: '3', title: '3' },
      { value: '4', title: '4' },
    ])
  })

  it('shows only the auto option when the core count is unknown', () => {
    const wrapper = mountRun({ availableCpuCores: 0 })

    expect(wrapper.findComponent(Dropdown).props('options')).toHaveLength(1)
  })

  it('maps the saved cpu cores into the dropdown value', () => {
    expect(mountRun({ cpuCores: 4 }).findComponent(Dropdown).props('modelValue')).toBe('4')
    expect(mountRun().findComponent(Dropdown).props('modelValue')).toBe('auto')
  })

  it('emits null for auto and the picked number otherwise', () => {
    const wrapper = mountRun()
    const dropdown = wrapper.findComponent(Dropdown)

    dropdown.vm.$emit('update:modelValue', 'auto')
    dropdown.vm.$emit('update:modelValue', '2')

    expect(wrapper.emitted('update:cpuCores')).toEqual([[null], [2]])
  })

  it('explains the auto mode and warns on a single core', () => {
    const auto = mountRun()
    expect(auto.find('.project-run__cores-hint').text()).toContain('JVM сама определит')
    expect(auto.find('.project-run__cores-warning').exists()).toBe(false)

    const single = mountRun({ cpuCores: 1 })
    expect(single.find('.project-run__cores-warning').text()).toContain('SerialGC')
  })
})

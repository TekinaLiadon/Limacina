import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Dropdown } from '@/06-shared'
import JvmPreset from '../JvmPreset.vue'

const mountPreset = (jvmArgs = '', javaVersion: number | null = 21) =>
  mount(JvmPreset, { props: { jvmArgs, javaVersion } })

const dropdownValues = (jvmArgs: string, javaVersion: number | null): unknown[] =>
  (mountPreset(jvmArgs, javaVersion).findComponent(Dropdown).props('options') as { value: string }[])
    .map((option) => option.value)

describe('JvmPreset', () => {
  it('keeps the current preset selected', () => {
    const wrapper = mountPreset('-XX:+UseSerialGC, -XX:+DisableExplicitGC', 8)

    expect(wrapper.findComponent(Dropdown).props('modelValue')).toBe('serial')
  })

  it('offers only the presets the java version supports', () => {
    expect(dropdownValues('', 8)).toEqual(['default', 'g1', 'serial'])
    expect(dropdownValues('', 21)).toEqual(['default', 'g1', 'serial', 'zgc'])
    expect(dropdownValues('', null)).toEqual(['default', 'g1', 'serial'])
  })

  it('emits the arguments of the chosen preset', () => {
    const wrapper = mountPreset('', 21)

    wrapper.findComponent(Dropdown).vm.$emit('update:modelValue', 'zgc')

    const emitted = wrapper.emitted('update:jvmArgs') ?? []
    expect(emitted[0]?.[0]).toContain('-XX:+UseZGC')
  })

  it('keeps custom arguments when a preset is applied', () => {
    const wrapper = mountPreset('-Dcustom=1', 21)

    wrapper.findComponent(Dropdown).vm.$emit('update:modelValue', 'serial')

    const emitted = wrapper.emitted('update:jvmArgs') ?? []
    expect(emitted[0]?.[0]).toBe('-Dcustom=1, -XX:+UseSerialGC, -XX:+DisableExplicitGC')
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GameDropdownField from '../game/GameDropdownField.vue'

const fieldSource = readFileSync(join(process.cwd(), 'src/03-widgets/tabs/settings/game/GameDropdownField.vue'), 'utf-8')
const colorsSource = readFileSync(join(process.cwd(), 'src/01-app/assets/colors.scss'), 'utf-8')

const options = [
  { title: 'Полный', value: 'full' },
  { title: 'Только команды', value: 'system' },
  { title: 'Скрыт', value: 'hidden' },
]

const mountField = (modelValue = 'system') =>
  mount(GameDropdownField, { props: { label: 'Видимость чата', options, modelValue } })

describe('GameDropdownField', () => {
  it('renders the label with the selected option and emits the picked value', async () => {
    const wrapper = mountField()

    expect(wrapper.find('.game-dropdown-field__text').text()).toBe('Видимость чата')
    expect(wrapper.find('.select-base__title').text()).toBe('Только команды')

    await wrapper.find('.select-base__value').trigger('click')
    await wrapper.findAll('.select-base-options__item')[2]?.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['hidden'])

    wrapper.unmount()
  })

  it('gives the control the settings min-width through the class the dropdown actually renders', () => {
    expect(fieldSource).toContain('min-width: var(--settings-control-min-width)')
    expect(fieldSource).toMatch(/\.select-base\s*\{[^}]*min-width: var\(--settings-control-min-width\)/)
    expect(fieldSource).not.toContain('.dropdown__value')
  })

  it('keeps the settings control min width token defined globally', () => {
    expect(colorsSource).toMatch(/--settings-control-min-width:\s*\d+px/)
  })
})

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ResourcePacksOptions from '../game/ResourcePacksOptions.vue'
import { DEFAULT_GAME_OPTIONS } from '@/04-features'
import type { GameOptions } from '@/05-entities'

const makeOptions = (resourcePacks: string[]): GameOptions => ({
  ...DEFAULT_GAME_OPTIONS,
  resourcePacks,
})

const mountPacks = (resourcePacks: string[], availablePacks: string[]) =>
  mount(ResourcePacksOptions, { props: { options: makeOptions(resourcePacks), availablePacks } })

describe('ResourcePacksOptions', () => {
  it('labels packs without the file prefix and marks enabled ones', () => {
    const wrapper = mountPacks(['file/Faithful.zip'], ['file/Faithful.zip', 'file/folder-pack'])

    const labels = wrapper.findAll('.checkbox__label').map((node) => node.text())
    expect(labels).toEqual(['Faithful.zip', 'folder-pack'])

    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes[0]?.element.checked).toBe(true)
    expect(checkboxes[1]?.element.checked).toBe(false)

    wrapper.unmount()
  })

  it('adds and removes the pack entry in the game format', async () => {
    const wrapper = mountPacks([], ['file/Faithful.zip'])

    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('update:options')?.[0]).toEqual([
      expect.objectContaining({ resourcePacks: ['file/Faithful.zip'] }),
    ])

    await wrapper.setProps({ options: makeOptions(['file/Faithful.zip']) })
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('update:options')?.[1]).toEqual([
      expect.objectContaining({ resourcePacks: [] }),
    ])

    wrapper.unmount()
  })

  it('shows the empty state without packs', () => {
    const wrapper = mountPacks([], [])

    expect(wrapper.find('.resource-packs-options__empty').text()).toBe(
      'В папке resourcepacks нет ресурсных пакетов',
    )
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)

    wrapper.unmount()
  })
})

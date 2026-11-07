import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, useOptionalModsStore } from '@/05-entities'
import type { ProjectConfig } from '@/06-shared/types/ipc'
import ProjectMods from '../ProjectMods.vue'

const makeConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'fabric',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  cpuCores: null,
  online: true,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
  optionalMods: [],
  ...overrides,
})

const applyVisibility = (list: { path: string; hash: string }[] | null, config: ProjectConfig | null): void => {
  const optionalMods = useOptionalModsStore()
  if (list === null) optionalMods.reset()
  else optionalMods.setList(list)
  useCoreStore().projectConfig = config
}

const mountMods = (optionalMods: string[] = []) =>
  mount(ProjectMods, {
    props: {
      optionalMods,
    },
  })

describe('ProjectMods', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a checkbox per server entry with the file name as the label', () => {
    applyVisibility(
      [
        { path: 'optional-mods/immersive.jar', hash: 'h1' },
        { path: 'optional-mods/jei.jar', hash: 'h2' },
      ],
      makeConfig(),
    )

    const wrapper = mountMods()

    expect(wrapper.find('.project-mods').exists()).toBe(true)
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(2)
    expect(wrapper.findAll('.checkbox__label').map((label) => label.text())).toEqual([
      'immersive.jar',
      'jei.jar',
    ])
  })

  it('starts every checkbox unchecked without a saved selection', () => {
    applyVisibility(
      [
        { path: 'optional-mods/immersive.jar', hash: 'h1' },
        { path: 'optional-mods/jei.jar', hash: 'h2' },
      ],
      makeConfig(),
    )

    const wrapper = mountMods()

    const checked = wrapper
      .findAll<HTMLInputElement>('input[type=checkbox]')
      .filter((input) => input.element.checked)
    expect(checked).toHaveLength(0)
  })

  it('marks the saved selection as checked', () => {
    applyVisibility([{ path: 'optional-mods/immersive.jar', hash: 'h1' }], makeConfig())

    const wrapper = mountMods(['optional-mods/immersive.jar'])

    const [input] = wrapper.findAll<HTMLInputElement>('input[type=checkbox]')
    expect(input?.element.checked).toBe(true)
  })

  it('emits the selection with the added path when a checkbox is toggled on', async () => {
    applyVisibility(
      [
        { path: 'optional-mods/immersive.jar', hash: 'h1' },
        { path: 'optional-mods/jei.jar', hash: 'h2' },
      ],
      makeConfig(),
    )

    const wrapper = mountMods(['optional-mods/jei.jar'])
    const [input] = wrapper.findAll('input[type=checkbox]')

    await input?.setValue(true)

    const emitted = wrapper.emitted('update:optionalMods')
    expect(emitted).toHaveLength(1)
    const selection = emitted?.[0]?.[0] ?? []
    expect(selection).toHaveLength(2)
    expect(selection).toContain('optional-mods/jei.jar')
    expect(selection).toContain('optional-mods/immersive.jar')
  })

  it('emits the selection without the path when a checkbox is toggled off', async () => {
    applyVisibility([{ path: 'optional-mods/immersive.jar', hash: 'h1' }], makeConfig())

    const wrapper = mountMods(['optional-mods/immersive.jar'])
    const [input] = wrapper.findAll('input[type=checkbox]')

    await input?.setValue(false)

    expect(wrapper.emitted('update:optionalMods')).toEqual([[[]]])
  })

  it('keeps the section out of the DOM for an empty server list', () => {
    applyVisibility([], makeConfig())

    expect(mountMods().find('.project-mods').exists()).toBe(false)
  })

  it('keeps the section out of the DOM while the list was never fetched', () => {
    applyVisibility(null, makeConfig())

    expect(mountMods().find('.project-mods').exists()).toBe(false)
  })

  it('keeps the section out of the DOM for an offline profile', () => {
    applyVisibility([{ path: 'optional-mods/immersive.jar', hash: 'h1' }], makeConfig({ online: false }))

    expect(mountMods().find('.project-mods').exists()).toBe(false)
  })

  it('keeps the section out of the DOM for a vanilla profile', () => {
    applyVisibility([{ path: 'optional-mods/immersive.jar', hash: 'h1' }], makeConfig({ modLoader: 'vanilla' }))

    expect(mountMods().find('.project-mods').exists()).toBe(false)
  })
})

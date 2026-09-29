import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectSettingsStore, type ProjectSettingsForm } from './projectSettingsStore'

const makeForm = (overrides: Partial<ProjectSettingsForm> = {}): ProjectSettingsForm => ({
  projectName: 'Alpha',
  mcVersion: '1.20.1',
  modLoader: 'fabric',
  loaderVersion: '0.15.0',
  javaPath: '/java',
  javaVersion: 21,
  jvmArgs: '',
  memoryRange: [1024, 4096],
  online: true,
  initialized: true,
  serverUrl: 'https://example.com',
  autoJoinServer: false,
  ...overrides,
})

describe('useProjectSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with an empty unloading state', () => {
    const store = useProjectSettingsStore()
    expect(store.config.projectName).toBe('')
    expect(store.config.modLoader).toBe('vanilla')
    expect(store.config.memoryRange).toEqual([512, 4096])
    expect(store.isLoaded).toBe(false)
    expect(store.isSaving).toBe(false)
    expect(store.loadError).toBe('')
    expect(store.loadedProject).toBe('')
    expect(store.loadingProject).toBe('')
  })

  it('startLoading resets the error and the loaded flag', () => {
    const store = useProjectSettingsStore()
    store.loadError = 'old'
    store.isLoaded = true
    store.startLoading('Alpha')
    expect(store.loadingProject).toBe('Alpha')
    expect(store.loadError).toBe('')
    expect(store.isLoaded).toBe(false)
  })

  it('applyLoaded accepts the result for the project being loaded', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())
    expect(store.isLoaded).toBe(true)
    expect(store.loadedProject).toBe('Alpha')
    expect(store.loadingProject).toBe('')
    expect(store.config.mcVersion).toBe('1.20.1')
    expect(store.loadError).toBe('')
  })

  it('applyLoaded ignores a stale result after the target changed', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.startLoading('Beta')
    store.applyLoaded('Alpha', makeForm())
    expect(store.isLoaded).toBe(false)
    expect(store.loadedProject).toBe('')
    expect(store.loadingProject).toBe('Beta')
  })

  it('applyError restores defaults and stores the message', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())
    store.startLoading('Beta')
    store.applyError('Beta', 'Не удалось загрузить')
    expect(store.isLoaded).toBe(false)
    expect(store.loadedProject).toBe('')
    expect(store.loadingProject).toBe('')
    expect(store.loadError).toBe('Не удалось загрузить')
    expect(store.config.projectName).toBe('')
    expect(store.config.modLoader).toBe('vanilla')
  })

  it('applyError ignores a stale error after the target changed', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.startLoading('Beta')
    store.applyError('Alpha', 'Поздняя ошибка')
    expect(store.loadError).toBe('')
    expect(store.loadingProject).toBe('Beta')
  })

  it('finishLoading clears the loading marker only for the current target', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.finishLoading('Beta')
    expect(store.loadingProject).toBe('Alpha')
    store.finishLoading('Alpha')
    expect(store.loadingProject).toBe('')
  })

  it('tracks the saving flag', () => {
    const store = useProjectSettingsStore()
    store.startSaving()
    expect(store.isSaving).toBe(true)
    store.finishSaving()
    expect(store.isSaving).toBe(false)
  })
})

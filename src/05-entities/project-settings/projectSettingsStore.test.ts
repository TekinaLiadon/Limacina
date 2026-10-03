import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectConfig } from '../core/types'
import { projectSettingsFormFromConfig, useProjectSettingsStore, type ProjectSettingsForm } from './projectSettingsStore'

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
    expect(store.baseline).toBeNull()
    expect(store.isDirty).toBe(false)
  })

  it('captures the baseline on load and tracks unsaved edits', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())

    expect(store.isDirty).toBe(false)

    store.config.jvmArgs = '-XX:+UseG1GC'
    expect(store.isDirty).toBe(true)
    expect(store.isFieldDirty('jvmArgs')).toBe(true)
    expect(store.isFieldDirty('javaPath')).toBe(false)

    store.captureBaseline()
    expect(store.isDirty).toBe(false)
  })

  it('keeps the dirty baseline across store re-accesses like a page remount', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())
    store.config.javaPath = '/java/other'

    const remounted = useProjectSettingsStore()
    expect(remounted.isDirty).toBe(true)
    expect(remounted.isFieldDirty('javaPath')).toBe(true)
    expect(remounted.isFieldDirty('loaderVersion')).toBe(false)
  })

  it('drops the baseline while loading or on error', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())
    store.config.memoryRange = [2048, 8192]
    expect(store.isDirty).toBe(true)

    store.startLoading('Beta')
    expect(store.isDirty).toBe(false)
    expect(store.baseline).toBeNull()

    store.applyError('Beta', 'Не удалось загрузить')
    expect(store.baseline).toBeNull()
    expect(store.isDirty).toBe(false)
  })

  it('ignores non-tracked fields when computing dirtiness', () => {
    const store = useProjectSettingsStore()
    store.startLoading('Alpha')
    store.applyLoaded('Alpha', makeForm())

    store.config.mcVersion = '1.20.4'
    store.config.serverUrl = 'https://changed.example.com'
    expect(store.isDirty).toBe(false)
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

  it('adoptLoaded fills the form without the loading guard', () => {
    const store = useProjectSettingsStore()
    store.adoptLoaded('Alpha', makeForm())

    expect(store.isLoaded).toBe(true)
    expect(store.loadedProject).toBe('Alpha')
    expect(store.loadingProject).toBe('')
    expect(store.loadError).toBe('')
    expect(store.isDirty).toBe(false)
  })

  it('adoptLoaded clears a stale error state', () => {
    const store = useProjectSettingsStore()
    store.applyError('Alpha', 'Не удалось загрузить')
    store.adoptLoaded('Alpha', makeForm())

    expect(store.loadError).toBe('')
    expect(store.isLoaded).toBe(true)
  })
})

describe('projectSettingsFormFromConfig', () => {
  const makeConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
    projectName: 'Alpha',
    mcVersion: '1.20.1',
    modLoader: 'fabric',
    loaderVersion: null,
    javaPath: null,
    javaVersion: null,
    jvmArgs: [],
    minMemory: '-Xms512M',
    maxMemory: '-Xmx4G',
    online: true,
    initialized: true,
    serverUrl: null,
    autoJoinServer: false,
    ...overrides,
  })

  it('maps the config fields into the form defaults', () => {
    const form = projectSettingsFormFromConfig(makeConfig())
    expect(form.loaderVersion).toBe('')
    expect(form.javaPath).toBe('')
    expect(form.javaVersion).toBeNull()
    expect(form.jvmArgs).toBe('')
    expect(form.memoryRange).toEqual([512, 4096])
  })

  it('maps memory and jvm args into editable strings', () => {
    const form = projectSettingsFormFromConfig(
      makeConfig({
        loaderVersion: '0.15.0',
        javaPath: '/java',
        javaVersion: 21,
        jvmArgs: ['-Xms512M', '-XX:+UseG1GC'],
        minMemory: '2G',
        maxMemory: '-Xmx8192M',
      }),
    )
    expect(form.loaderVersion).toBe('0.15.0')
    expect(form.javaPath).toBe('/java')
    expect(form.javaVersion).toBe(21)
    expect(form.jvmArgs).toBe('-Xms512M, -XX:+UseG1GC')
    expect(form.memoryRange).toEqual([2048, 8192])
  })

  it('falls back to default memory values for unreadable entries', () => {
    const form = projectSettingsFormFromConfig(makeConfig({ minMemory: 'abc', maxMemory: '' }))
    expect(form.memoryRange).toEqual([512, 4096])
  })
})

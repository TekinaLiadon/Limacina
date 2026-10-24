import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import JSZip from 'jszip'
import { deleteModel, readSkinFile, savePlayerModel, uploadModel } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type CPMConfig, type UserContentItem } from '@/05-entities'
import { makeProjectConfig } from '@/test-support/fixtures'
import { parsePresetProject, type ParsedPreset } from '../presetLoader'
import { decodePngSkin, encodePngSkin } from '../skinPng'
import { usePresetSkinApply } from '../usePresetSkinApply'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  savePlayerModel: vi.fn(),
  uploadModel: vi.fn(),
  deleteModel: vi.fn(),
  readSkinFile: vi.fn(),
}))

const drop = vi.hoisted(() => ({
  options: null as {
    accept: readonly string[]
    onDrop: (path: string) => void
    onError: (message: string) => void
  } | null,
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  useFileDrop: (options: {
    accept: readonly string[]
    onDrop: (path: string) => void
    onError: (message: string) => void
  }) => {
    drop.options = options
    return { isDragOver: { value: false } }
  },
}))

const BASE_CONFIG: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  skinType: 'default',
  elements: [
    {
      id: 'body',
      name: 'body',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [
        {
          name: 'torso',
          size: { x: 8, y: 12, z: 4 },
          offset: { x: -4, y: 0, z: -2 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          u: 16,
          v: 16,
          textureSize: 1,
          storeID: 11,
        },
      ],
    },
  ],
}

const NARROW_CEILING_CONFIG: CPMConfig = {
  ...BASE_CONFIG,
  elements: [
    {
      ...BASE_CONFIG.elements[0]!,
      children: [
        {
          ...BASE_CONFIG.elements[0]!.children![0]!,
          name: 'plate',
          size: { x: 0.5, y: 0.5, z: 0.5 },
          u: 0,
          v: 0,
          textureSize: 64,
          singleTex: true,
        },
      ],
    },
  ],
}

async function makePreset(config: CPMConfig, skinType: 'slim' | 'classic' | 'both'): Promise<ParsedPreset> {
  const zip = new JSZip()
  zip.file('config.json', JSON.stringify(config))
  const projectData = await zip.generateAsync({ type: 'uint8array' })
  return parsePresetProject(projectData, new TextEncoder().encode(JSON.stringify({
    name: 'Female Body',
    slug: 'female-body',
    skinType,
  })))
}

async function makeSkinBytes(size: number, red: number, height: number = size): Promise<Uint8Array> {
  const rgba = new Uint8Array(size * height * 4)
  for (let i = 0; i < size * height; i++) {
    rgba[i * 4] = red
    rgba[i * 4 + 1] = 30
    rgba[i * 4 + 2] = 60
    rgba[i * 4 + 3] = 255
  }
  return encodePngSkin({ width: size, height, rgba })
}

const uploadedItem = (id: number): UserContentItem => ({ id, url: `https://cdn/model-${id}.txt`, active: false })

const waitForDressed = async (flow: ReturnType<typeof usePresetSkinApply>): Promise<void> => {
  await vi.waitFor((): void => {
    if (flow.preview.value?.dressed == null) throw new Error('превью модели не собрано')
  })
}

function setupFlow(): {
  preset: ReturnType<typeof shallowRef<ParsedPreset | null>>
  previewSkinBytes: ReturnType<typeof shallowRef<Uint8Array | null>>
  flow: ReturnType<typeof usePresetSkinApply>
} {
  const preset = shallowRef<ParsedPreset | null>(null)
  const previewSkinBytes = shallowRef<Uint8Array | null>(null)
  const { result } = withSetup(() => usePresetSkinApply({ preset, previewSkinBytes }))
  return { preset, previewSkinBytes, flow: result }
}

describe('usePresetSkinApply', () => {
  let urlCounter = 0
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    URL.createObjectURL = vi.fn((): string => `blob:preset-${++urlCounter}`)
    URL.revokeObjectURL = vi.fn()
    vi.mocked(savePlayerModel).mockReset()
    vi.mocked(uploadModel).mockReset()
    vi.mocked(deleteModel).mockReset()
    vi.mocked(readSkinFile).mockReset()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('builds a dressed preview from the preset and the uploaded skin', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'classic')

    await flow.setSkin(await makeSkinBytes(64, 200))
    await waitForDressed(flow)

    expect(flow.errorMessage.value).toBe('')
    expect(flow.preview.value).not.toBeNull()
    expect(flow.preview.value?.cpmData.config.skinSize).toEqual({ x: 64, y: 64 })
    expect(flow.preview.value?.cpmData.textureUrl).toContain('blob:preset-')
    expect(flow.preview.value?.dressed).not.toBeNull()
    expect(flow.activeLayerIds.value).toEqual([11])
    expect(flow.skinWarnings.value).toEqual([])
  })

  it('falls back to the package preview skin before the user uploads one', async () => {
    const { preset, previewSkinBytes, flow } = setupFlow()
    previewSkinBytes.value = await makeSkinBytes(64, 90)
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flushPromises()

    expect(flow.preview.value?.cpmData.textureUrl).toContain('blob:preset-')
    expect(flow.preview.value?.dressed).toBeNull()
    expect(flow.preview.value?.cpmData.config).toEqual(BASE_CONFIG)
  })

  it('keeps the preview empty without a package preview skin', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flushPromises()

    expect(flow.preview.value).toBeNull()
  })

  it('rejects an invalid skin file without breaking the preview', async () => {
    const { preset, previewSkinBytes, flow } = setupFlow()
    previewSkinBytes.value = await makeSkinBytes(64, 90)
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flushPromises()

    await flow.setSkin(await makeSkinBytes(100, 10))

    expect(flow.errorMessage.value).toContain('кратна')
    expect(flow.skinImage.value).toBeNull()
    expect(flow.preview.value?.dressed).toBeNull()
  })

  it('normalizes a legacy 64×32 skin into a square dressed model', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')

    await flow.setSkin(await makeSkinBytes(64, 120, 32))
    await waitForDressed(flow)

    const dressed = flow.preview.value?.dressed
    expect(dressed).not.toBeNull()
    expect(await decodePngSkin(dressed!.skinPng)).toMatchObject({ width: 64, height: 64 })
  })

  it('downscales an HD skin above the preset ceiling with a warning', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(NARROW_CEILING_CONFIG, 'both')

    await flow.setSkin(await makeSkinBytes(128, 150))
    await waitForDressed(flow)

    const dressed = flow.preview.value?.dressed
    expect(dressed).not.toBeNull()
    expect(await decodePngSkin(dressed!.skinPng)).toMatchObject({ width: 64, height: 64 })
    expect(dressed?.config.skinSize).toEqual({ x: 64, y: 64 })
    expect(flow.skinWarnings.value.join(' ')).toContain('уменьшен до 64×64')
  })

  it('warns about a skin type mismatch without blocking', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'classic')

    await flow.setSkin(await makeSkinBytes(64, 200))
    flow.skinMode.value = 'slim'
    await vi.waitFor((): void => {
      if (flow.preview.value?.cpmData.config.skinType !== 'slim') throw new Error('превью не пересобрано')
    })

    expect(flow.skinWarnings.value.length).toBe(1)
    expect(flow.skinWarnings.value[0]).toContain('slim')
    expect(flow.preview.value?.cpmData.config.skinType).toBe('slim')
  })

  it('applies the model online through upload and savePlayerModel', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.projectConfig = makeProjectConfig({ online: true })
    vi.mocked(uploadModel).mockResolvedValue(uploadedItem(7))
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)

    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flow.setSkin(await makeSkinBytes(64, 200))
    await waitForDressed(flow)

    await flow.applyPreset()
    await flushPromises()

    expect(vi.mocked(uploadModel)).toHaveBeenCalledTimes(1)
    const [link] = vi.mocked(uploadModel).mock.calls[0]!
    expect(typeof link).toBe('string')
    expect(link.length).toBeGreaterThan(0)
    expect(vi.mocked(savePlayerModel)).toHaveBeenCalledWith('proj', {
      name: 'Female Body',
      url: 'https://cdn/model-7.txt',
      modelId: 7,
      slim: false,
      data: null,
    })
    expect(useNotificationStore().message).toBe('Модель добавлена в игру')
    expect(flow.isApplying.value).toBe(false)
  })

  it('passes the slim flag of the selected mode', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    vi.mocked(uploadModel).mockResolvedValue(uploadedItem(7))
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)

    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flow.setSkin(await makeSkinBytes(64, 200))
    flow.skinMode.value = 'slim'
    await vi.waitFor((): void => {
      if (flow.preview.value?.cpmData.config.skinType !== 'slim') throw new Error('превью не пересобрано')
    })

    await flow.applyPreset()

    expect(vi.mocked(savePlayerModel)).toHaveBeenCalledWith('proj', expect.objectContaining({ slim: true }))
  })

  it('saves the model into the game offline', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.projectConfig = makeProjectConfig({ online: false })
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)

    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flow.setSkin(await makeSkinBytes(64, 200))
    await waitForDressed(flow)

    expect(flow.isOffline.value).toBe(true)
    await flow.applyPreset()

    expect(vi.mocked(uploadModel)).not.toHaveBeenCalled()
    expect(vi.mocked(savePlayerModel)).toHaveBeenCalledTimes(1)
    const [project, payload] = vi.mocked(savePlayerModel).mock.calls[0]!
    expect(project).toBe('proj')
    expect(payload.url).toBeNull()
    expect(payload.data).not.toBeNull()
    expect(payload.data!.length).toBeGreaterThan(0)
    expect(useNotificationStore().message).toBe('Модель сохранена в игру')
  })

  it('rolls back the uploaded model when saving fails', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    vi.mocked(uploadModel).mockResolvedValue(uploadedItem(7))
    vi.mocked(savePlayerModel).mockRejectedValue(new Error('диск недоступен'))
    vi.mocked(deleteModel).mockResolvedValue(undefined)

    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flow.setSkin(await makeSkinBytes(64, 200))
    await waitForDressed(flow)

    await flow.applyPreset()

    expect(vi.mocked(deleteModel)).toHaveBeenCalledWith(7)
    expect(flow.errorMessage.value).toContain('диск недоступен')
    expect(useNotificationStore().message).not.toBe('Модель добавлена в игру')
    expect(flow.isApplying.value).toBe(false)
  })

  it('skips the apply without a user skin', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'both')
    await flushPromises()

    await flow.applyPreset()

    expect(vi.mocked(savePlayerModel)).not.toHaveBeenCalled()
    expect(vi.mocked(uploadModel)).not.toHaveBeenCalled()
  })

  it('skips the apply without a selected preset', async () => {
    const { flow } = setupFlow()

    await flow.applyPreset()

    expect(vi.mocked(savePlayerModel)).not.toHaveBeenCalled()
  })

  it('loads a skin from a dropped png file path', async () => {
    const { preset, flow } = setupFlow()
    preset.value = await makePreset(BASE_CONFIG, 'classic')
    vi.mocked(readSkinFile).mockResolvedValue(await makeSkinBytes(64, 120))

    drop.options?.onDrop('/home/user/Downloads/Break.png')
    await waitForDressed(flow)

    expect(vi.mocked(readSkinFile).mock.calls[0]?.[0]).toBe('/home/user/Downloads/Break.png')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.preview.value?.dressed).not.toBeNull()
  })

  it('ignores a dropped cpmproject file', async () => {
    const { flow } = setupFlow()

    drop.options?.onDrop('/home/user/Downloads/model.cpmproject')
    await flushPromises()

    expect(vi.mocked(readSkinFile)).not.toHaveBeenCalled()
    expect(flow.errorMessage.value).toBe('')
  })

  it('asks to pick a preset first when a png is dropped without one', async () => {
    const { flow } = setupFlow()

    drop.options?.onDrop('/home/user/Downloads/Break.png')
    await flushPromises()

    expect(vi.mocked(readSkinFile)).not.toHaveBeenCalled()
    expect(flow.errorMessage.value).toBe('Сначала выберите модель из галереи')
  })

  it('shows the format message for a foreign dropped file', async () => {
    const { flow } = setupFlow()

    drop.options?.onError('Допустимый формат: .png, .cpmproject')

    expect(flow.errorMessage.value).toBe('Допустимый формат: .png, .cpmproject')
  })
})

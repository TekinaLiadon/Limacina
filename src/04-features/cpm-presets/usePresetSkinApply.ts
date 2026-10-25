import { ref, shallowRef, computed, watch, onScopeDispose, type ComputedRef, type ShallowRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, type CPMChild, type CPMData, type SkinModelMode, type UserContentItem } from '@/05-entities'
import { captureProjectScope, reportError, selectFile, useAsyncRaceGuard, useFileDrop } from '@/06-shared'
import { getErrorMessage, readSkinFile, savePlayerModel } from '@/06-shared/api'
import { bytesToBase64 } from '@/04-features/cpm-convert/cpmBinaryWriter'
import { cpmConfigToBytes, cpmConfigToLinkBytes } from '@/04-features/cpm-convert/cpmProjectExporter'
import { useModelUserContent, type ModelUserContent } from '@/04-features/user-content/useUserContent'
import { compose, presetSkinTypeWarning, type DressedModel } from './dress'
import type { ParsedPreset } from './presetLoader'
import { LOGICAL_ATLAS_SIZE } from './presetTypes'
import { downscaleSkin } from './downscaleSkin'
import { maxPresetSkinScale } from './presetValidator'
import { validateSkin, MAX_SKIN_FILE_BYTES } from './skinValidate'
import { normalizeSkin } from './skinNormalize'
import { scaleSkinLayout } from './skinScale'
import { fillAuxRegions } from './skinAuxFill'
import type { SkinImage } from './skinPng'

export interface PresetSkinApplySource {
  preset: ShallowRef<ParsedPreset | null>
  previewSkinBytes: ShallowRef<Uint8Array | null>
  content?: ModelUserContent
}

export interface PresetApplyPreview {
  cpmData: CPMData
  dressed: DressedModel | null
}

const APPLY_ERROR_MESSAGE = 'Не удалось сохранить модель'
const APPLY_SUCCESS_MESSAGE = 'Модель добавлена в игру'
const OFFLINE_SUCCESS_MESSAGE = 'Модель сохранена в игру'

function collectLayerIds(children: CPMChild[] | undefined, result: number[]): void {
  if (!children) return
  for (const child of children) {
    if (typeof child.storeID === 'number') result.push(child.storeID)
    collectLayerIds(child.children, result)
  }
}

export function usePresetSkinApply(source: PresetSkinApplySource): {
  skinImage: ShallowRef<SkinImage | null>
  skinMode: Ref<SkinModelMode>
  errorMessage: Ref<string>
  skinWarnings: ComputedRef<string[]>
  preview: ShallowRef<PresetApplyPreview | null>
  activeLayerIds: ComputedRef<number[]>
  isOffline: ComputedRef<boolean>
  isApplying: Ref<boolean>
  isDragOver: Ref<boolean>
  selectSkinFile: () => void
  setSkin: (bytes: Uint8Array) => Promise<void>
  applyPreset: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const content = source.content ?? useModelUserContent()
  const { errorMessage } = content
  const skinImage = shallowRef<SkinImage | null>(null)
  const skinMode = ref<SkinModelMode>('classic')
  const downscaleNote = ref<string | null>(null)
  const preview = shallowRef<PresetApplyPreview | null>(null)
  const isApplying = ref<boolean>(false)

  const previewGuard = useAsyncRaceGuard()

  const skinWarnings = computed((): string[] => {
    const current = source.preset.value
    if (!current || skinImage.value === null) return []
    const warnings: string[] = []
    if (downscaleNote.value !== null) warnings.push(downscaleNote.value)
    const typeWarning = presetSkinTypeWarning(current.meta.skinType, skinMode.value)
    if (typeWarning !== null) warnings.push(typeWarning)
    return warnings
  })

  const activeLayerIds = computed((): number[] => {
    const ids: number[] = []
    for (const root of source.preset.value?.config.elements ?? []) {
      collectLayerIds(root.children, ids)
    }
    return ids
  })

  const setSkin = async (bytes: Uint8Array): Promise<void> => {
    const current = source.preset.value
    if (!current) return

    const validation = validateSkin(bytes)
    if (validation.errors.length > 0) {
      errorMessage.value = validation.errors[0] ?? 'Некорректный файл скина'
      return
    }

    errorMessage.value = ''
    downscaleNote.value = null
    try {
      let image = await normalizeSkin(bytes)
      const ceiling = maxPresetSkinScale(current.config)
      if (image.width / LOGICAL_ATLAS_SIZE > ceiling) {
        const edge = LOGICAL_ATLAS_SIZE * ceiling
        image = downscaleSkin(image, edge)
        downscaleNote.value = `Скин уменьшен до ${edge}×${edge}: пресет поддерживает скины до S=${ceiling}`
      }
      skinImage.value = image
    } catch (e: unknown) {
      reportError('Не удалось обработать скин', e)
      errorMessage.value = getErrorMessage(e)
    }
  }

  const selectSkinFile = (): void => {
    errorMessage.value = ''
    selectFile({
      accept: '.png,image/png',
      maxBytes: MAX_SKIN_FILE_BYTES,
      readAs: 'arrayBuffer',
      onError: (message: string): void => {
        errorMessage.value = message
      },
      onLoad: (_file: File, result: string | ArrayBuffer): void => {
        void setSkin(new Uint8Array(result as ArrayBuffer))
      },
    })
  }

  const { isDragOver } = useFileDrop({
    accept: ['png', 'cpmproject'],
    onDrop: (path: string): void => {
      if (!path.toLowerCase().endsWith('.png')) return
      if (source.preset.value === null) {
        errorMessage.value = 'Сначала выберите модель из галереи'
        return
      }
      errorMessage.value = ''
      void readSkinFile(path)
        .then((bytes: Uint8Array): void => {
          void setSkin(bytes)
        })
        .catch((e: unknown): void => {
          reportError('Не удалось прочитать скин', e)
          errorMessage.value = getErrorMessage(e)
        })
    },
    onError: (message: string): void => {
      errorMessage.value = message
    },
  })

  const revokePreviewUrl = (): void => {
    const data = preview.value?.cpmData
    if (data) URL.revokeObjectURL(data.textureUrl)
  }

  const rebuildPreview = async (): Promise<void> => {
    const generation = previewGuard.next()
    const current = source.preset.value
    if (!current) {
      if (!previewGuard.isCurrent(generation)) return
      revokePreviewUrl()
      preview.value = null
      return
    }

    try {
      let dressed: DressedModel | null = null

      const image = skinImage.value
      if (image !== null) {
        const scaled = scaleSkinLayout(current.config, image.width / LOGICAL_ATLAS_SIZE)
        const filled = fillAuxRegions(image, current.meta.auxRegions)
        dressed = await compose(scaled, filled, skinMode.value)
      }

      const textureBytes = dressed?.skinPng ?? source.previewSkinBytes.value
      if (textureBytes === null) {
        if (!previewGuard.isCurrent(generation)) return
        revokePreviewUrl()
        preview.value = null
        return
      }

      const textureUrl = URL.createObjectURL(new Blob([textureBytes], { type: 'image/png' }))
      if (!previewGuard.isCurrent(generation)) {
        URL.revokeObjectURL(textureUrl)
        return
      }
      revokePreviewUrl()
      preview.value = {
        cpmData: {
          config: dressed?.config ?? current.config,
          textureUrl,
          animations: current.animations,
          animEnc: current.animEnc,
        },
        dressed,
      }
    } catch (e: unknown) {
      if (!previewGuard.isCurrent(generation)) return
      reportError('Не удалось подготовить превью модели', e)
      errorMessage.value = getErrorMessage(e)
    }
  }

  watch(
    [() => source.preset.value, skinImage, skinMode],
    (): void => {
      void rebuildPreview()
    },
    { immediate: true },
  )

  const rollbackUploadedModel = async (item: UserContentItem): Promise<void> => {
    if (item.id === null || item.id === undefined) return
    await content.handleDelete(item.id)
  }

  const applyPreset = async (): Promise<void> => {
    const current = source.preset.value
    const dressed = preview.value?.dressed ?? null
    if (!current || !dressed || isApplying.value) return

    const scope = captureProjectScope((): string => coreStore.currentProject)
    isApplying.value = true
    errorMessage.value = ''
    let uploaded: UserContentItem | null = null
    try {
      const animationSource = { animations: current.animations, animEnc: current.animEnc }
      if (content.isOffline.value) {
        const bytes = cpmConfigToBytes(dressed.config, dressed.skinPng, animationSource)
        await savePlayerModel(scope.project, {
          name: current.meta.name,
          url: null,
          modelId: null,
          slim: skinMode.value === 'slim',
          data: Array.from(bytes),
        })
      } else {
        const link = bytesToBase64(cpmConfigToLinkBytes(dressed.config, dressed.skinPng, animationSource))
        uploaded = await content.handleUpload(link)
        if (uploaded === null) return
        try {
          await savePlayerModel(scope.project, {
            name: current.meta.name,
            url: uploaded.url,
            modelId: uploaded.id ?? null,
            slim: skinMode.value === 'slim',
            data: null,
          })
        } catch (e: unknown) {
          if (uploaded !== null) await rollbackUploadedModel(uploaded)
          throw e
        }
      }
      if (!scope.isCurrent()) return
      notification.show(content.isOffline.value ? OFFLINE_SUCCESS_MESSAGE : APPLY_SUCCESS_MESSAGE)
    } catch (e: unknown) {
      if (!scope.isCurrent()) return
      reportError(APPLY_ERROR_MESSAGE, e)
      errorMessage.value = getErrorMessage(e)
    } finally {
      isApplying.value = false
    }
  }

  onScopeDispose((): void => {
    previewGuard.cancel()
    revokePreviewUrl()
  })

  return {
    skinImage,
    skinMode,
    errorMessage,
    skinWarnings,
    preview,
    activeLayerIds,
    isOffline: content.isOffline,
    isApplying,
    isDragOver,
    selectSkinFile,
    setSkin,
    applyPreset,
  }
}

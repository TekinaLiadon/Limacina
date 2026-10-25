import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModelTab from '../ModelTab.vue'
import { useAccountsStore, useCoreStore } from '@/05-entities'
import { makeProjectConfig } from '@/test-support/fixtures'
import { encodePngSkin } from '@/04-features/cpm-presets/skinPng'

vi.mock('@/06-shared/utils/reportError', () => ({ reportError: vi.fn() }))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listModels: vi.fn().mockResolvedValue([]),
  readCpmProjectFile: vi.fn(),
  savePlayerModel: vi.fn(),
  uploadModel: vi.fn(),
  deleteModel: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({
    onDragDropEvent: async (): Promise<() => void> => () => {},
  }),
}))

const CpmViewerStub = {
  name: 'CpmViewer',
  template: '<div class="cpm-viewer__canvas" />',
}

let fileInput: HTMLInputElement | undefined

const pickSkinFile = async (wrapper: VueWrapper, bytes: Uint8Array, name: string): Promise<void> => {
  const file = new File([bytes as BlobPart], name, { type: 'image/png' })
  if (fileInput === undefined) throw new Error('file input was not created')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  fileInput.onchange?.(new Event('change'))
  await flushPromises()
  await vi.waitFor((): void => {
    const send = findButton(wrapper, 'Отправить')
    if (send?.attributes('disabled') !== undefined) throw new Error('скин не применён')
  })
}

const mountTab = (): VueWrapper =>
  mount(ModelTab, {
    global: {
      stubs: { CpmViewer: CpmViewerStub },
    },
  })

const findButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label)

const button = (wrapper: VueWrapper, label: string) => {
  const found = findButton(wrapper, label)
  if (!found) throw new Error(`кнопка «${label}» не найдена`)
  return found
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((): string => `blob:test-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
  fileInput = undefined
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName)
    if (tagName === 'input') fileInput = element as HTMLInputElement
    return element
  }) as typeof document.createElement)

  const core = useCoreStore()
  core.currentProject = 'proj'
  core.projectConfig = makeProjectConfig({ online: true })
  useAccountsStore().session = { uuid: 'u-1', username: 'alice' }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ModelTab skin flow (real composables)', () => {
  it('applies a picked skin to the builtin preset', async () => {
    const png = await encodePngSkin({ width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4).fill(80) })
    const wrapper = mountTab()
    await flushPromises()

    await button(wrapper, 'Готовая модель').trigger('click')
    await flushPromises()
    await vi.waitFor((): void => {
      if (wrapper.find('.model-tab__preset-select .select-base__title').text() !== 'Женское тело') {
        throw new Error('пресет не выбран автоматически')
      }
    })
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(true)
    expect(button(wrapper, 'Отправить').attributes('disabled')).toBeDefined()

    await button(wrapper, 'Загрузить скин').trigger('click')
    await pickSkinFile(wrapper, png, 'Break.png')

    expect(wrapper.find('.model-tab__viewer-empty').exists()).toBe(false)
    expect(wrapper.find('.model-tab__hint').exists()).toBe(false)
    expect(wrapper.find('.user-content-viewer__error').exists()).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import SetupPathStep from '../SetupPathStep.vue'

const selectedPath = ref<string>('')
const isLoading = ref<boolean>(false)
const selectFolder = vi.fn()
const save = vi.fn()

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useSetup: () => ({
      selectedPath,
      isLoading,
      fullDisplayPath: computed((): string => (selectedPath.value === '' ? '' : `/home/tekina/${selectedPath.value}`)),
      selectFolder,
      save,
    }),
  }
})

const mountStep = () => mount(SetupPathStep)

describe('SetupPathStep', () => {
  beforeEach((): void => {
    selectedPath.value = ''
    isLoading.value = false
    selectFolder.mockClear()
    save.mockClear()
  })

  it('renders the first-run head and locks the save button until a folder is chosen', () => {
    const wrapper = mountStep()

    expect(wrapper.get('.setup-path-step__eyebrow').text()).toBe('Первый запуск')
    expect(wrapper.get('h1').text()).toBe('Настройка лаунчера')
    expect(wrapper.get('.setup-path-step__description').text()).toBe('Укажите папку для хранения файлов лаунчера')
    expect(wrapper.get('input').attributes('placeholder')).toBe('Выберите папку')
    expect(wrapper.find('.setup-path-step__preview').exists()).toBe(false)
    expect(wrapper.get('.btn-primary').attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('opens the folder picker on demand', async () => {
    const wrapper = mountStep()

    await wrapper.get('.btn-secondary').trigger('click')

    expect(selectFolder).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('previews the resolved path and saves it once a folder is chosen', async () => {
    const wrapper = mountStep()

    selectedPath.value = 'launcher'
    await nextTick()

    expect(wrapper.get('.setup-path-step__preview-label').text()).toBe('Путь установки')
    expect(wrapper.get('.setup-path-step__preview-path').text()).toBe('/home/tekina/launcher')

    const saveButton = wrapper.get('.btn-primary')
    expect(saveButton.attributes('disabled')).toBeUndefined()
    await saveButton.trigger('click')
    expect(save).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('keeps the save button locked while the launcher is being initialized', () => {
    selectedPath.value = 'launcher'
    isLoading.value = true
    const wrapper = mountStep()

    const saveButton = wrapper.get('.btn-primary')
    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(saveButton.attributes('aria-busy')).toBe('true')

    wrapper.unmount()
  })
})

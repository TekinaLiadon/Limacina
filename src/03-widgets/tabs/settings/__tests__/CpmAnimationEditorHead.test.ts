import { describe, expect, it } from 'vitest'
import { computed } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import CpmAnimationEditorHead from '../cpm-animation-editor/CpmAnimationEditorHead.vue'
import {
  createCpmEditorMock,
  createCpmEditorMockWith,
} from '@/test-support/cpmEditorMock'
import type { CpmAnimationEditorApi } from '@/04-features'

const mountHead = (
  editor: CpmAnimationEditorApi,
  props: { isSaving?: boolean; saveError?: string } = {},
): VueWrapper =>
  mount(CpmAnimationEditorHead, {
    props: {
      editor,
      isSaving: props.isSaving ?? false,
      saveError: props.saveError ?? '',
    },
  })

const button = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> =>
  wrapper.find(`[aria-label="${label}"]`)

describe('CpmAnimationEditorHead', () => {
  it('renders and renames the animation', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountHead(editor)

    const nameInput = wrapper.find('.cpm-editor-head__input')
    expect((nameInput.element as HTMLInputElement).value).toBe('Машет')

    await nameInput.setValue('Приветствие')
    await nameInput.trigger('change')

    expect(editor.setName).toHaveBeenCalledWith('Приветствие')
  })

  it('keeps the name input readonly for a vanilla pose', () => {
    const wrapper = mountHead(createCpmEditorMockWith('vanilla-pose'))

    expect(button(wrapper, 'Имя анимации').attributes('readonly')).toBeDefined()
  })

  it('renders validation errors as an alert', () => {
    const wrapper = mountHead(createCpmEditorMock({
      saveErrors: computed(() => ['Имя анимации не может быть пустым']),
    }))

    expect(wrapper.find('[role="alert"]').text()).toContain('Имя анимации не может быть пустым')
  })

  it('renders the linear transition warning', () => {
    const wrapper = mountHead(createCpmEditorMock({
      saveWarnings: computed(() => ['Линейный интерполятор при заметной разнице между соседними ключами даёт механический переход']),
    }))

    expect(wrapper.find('.cpm-editor-head__warning').text()).toContain('механический')
  })

  it('renders the model save error', () => {
    const wrapper = mountHead(createCpmEditorMock(), {
      saveError: 'Не удалось сохранить модель',
    })

    expect(wrapper.find('[role="alert"]').text()).toContain('Не удалось сохранить модель')
  })

  it('exits editing from the header', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountHead(editor)

    const exitButton = wrapper.findAll('button').find((item) => item.text() === 'Выйти')
    await exitButton?.trigger('click')

    expect(editor.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('asks to save the model from the header', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountHead(editor)

    const saveButton = wrapper.findAll('button').find((item) => item.text() === 'Сохранить')
    await saveButton?.trigger('click')

    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(editor.stopEditing).not.toHaveBeenCalled()
  })

  it('shows the save progress and blocks the button while saving', () => {
    const wrapper = mountHead(createCpmEditorMock(), { isSaving: true })
    const saveButton = wrapper.findAll('button').find((item) => item.text() === 'Сохранить')

    expect(saveButton?.attributes('disabled')).toBeDefined()
    expect(saveButton?.attributes('aria-busy')).toBe('true')
  })

  it('no longer renders the animation delete action', () => {
    const wrapper = mountHead(createCpmEditorMock())

    expect(button(wrapper, 'Удалить анимацию').exists()).toBe(false)
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain('Удалить')
  })
})

import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import CpmAnimationTools from '../cpm-animation-editor/CpmAnimationTools.vue'
import {
  createCpmEditorMock,
  createCpmEditorMockWith,
} from '@/test-support/cpmEditorMock'
import type { CpmAnimationEditorApi } from '@/04-features'

const mountTools = (editor: CpmAnimationEditorApi): VueWrapper =>
  mount(CpmAnimationTools, { props: { editor } })

const button = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> =>
  wrapper.find(`[aria-label="${label}"]`)

const checkbox = (
  wrapper: VueWrapper,
  label: string,
): ReturnType<VueWrapper['find']> | undefined => {
  const row = wrapper.findAll('.checkbox').find((item) => item.text() === label)
  return row?.find('.checkbox__input')
}

describe('CpmAnimationTools', () => {
  it('selects bones from the tree', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const rows = wrapper.findAll('.cpm-bone-tree__row')
    expect(rows).toHaveLength(2)
    await rows[1]?.trigger('click')

    expect(editor.selectBone).toHaveBeenCalledWith(100)
    expect(rows[0]?.attributes('aria-selected')).toBe('true')
    expect(rows[1]?.attributes('aria-level')).toBe('2')
  })

  it('applies numeric rotation and position edits', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const rotation = wrapper.find('[aria-label="Поворот Y"]')
    await rotation.setValue('45')
    await rotation.trigger('change')
    expect(editor.setBoneRotation).toHaveBeenCalledWith('y', 45)

    const position = wrapper.find('[aria-label="Смещение Z"]')
    await position.setValue('1.5')
    await position.trigger('change')
    expect(editor.setBonePosition).toHaveBeenCalledWith('z', 1.5)
  })

  it('steps numeric fields with the custom arrows', () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const rotation = wrapper.find('[aria-label="Поворот Y"]')
    const field = rotation.element.closest('.cpm-pose__number')
    const up = field?.querySelector<HTMLButtonElement>('[aria-label="Увеличить значение"]')
    up?.click()

    expect(editor.setBoneRotation).toHaveBeenCalledWith('y', 31)
  })

  it('shows an empty state without a selected bone', () => {
    const wrapper = mountTools(createCpmEditorMock({
      selectedBoneId: ref(null),
      selectedBoneName: computed(() => null),
      selectedBonePose: computed(() => null),
    }))

    expect(wrapper.find('.cpm-pose__empty').text()).toContain('Выберите кость')
    expect(wrapper.find('[aria-label="Поворот Y"]').exists()).toBe(false)
  })

  it('renames the animation properties through the form', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    await wrapper.find('.cpm-props__trigger .select-base__value').trigger('click')
    const options = wrapper.findAll('.cpm-props__trigger .select-base-options__item')
    expect(options.map((option) => option.text())).toEqual([
      'Жест',
      'Своя поза',
      'Ванильная поза',
      'Слой',
      'Слой-значение',
      'Подготовка',
      'Завершение',
    ])

    await options[3]?.trigger('click')
    expect(editor.setKind).toHaveBeenCalledWith('layer')
  })

  it('selects a vanilla pose without the custom entry', async () => {
    const editor = createCpmEditorMockWith('vanilla-pose')
    const wrapper = mountTools(editor)

    const poseSelect = wrapper.find('.cpm-props__pose .select-base__value')
    expect(poseSelect.exists()).toBe(true)
    await poseSelect.trigger('click')

    const options = wrapper.findAll('.cpm-props__pose .select-base-options__item')
    expect(options[0]?.text()).toBe('standing')
    expect(options.map((option) => option.text())).not.toContain('custom')
    await options[0]?.trigger('click')

    expect(editor.setVanillaPose).toHaveBeenCalledWith(1)
  })

  it('shows the multiplier hint for a state-driven vanilla pose', () => {
    const wrapper = mountTools(createCpmEditorMockWith('vanilla-pose', {
      vanillaPoseHint: computed(() => 'Длительность работает как множитель'),
    }))

    expect(wrapper.find('.cpm-props__hint').text()).toContain('множитель')
  })

  it('updates the duration and the frame count', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const duration = wrapper.find('[aria-label="Длительность"]')
    await duration.setValue('1500')
    await duration.trigger('change')
    expect(editor.setDuration).toHaveBeenCalledWith(1500)

    const frames = wrapper.find('[aria-label="Количество кадров"]')
    await frames.setValue('8')
    await frames.trigger('change')
    expect(editor.setFrameCount).toHaveBeenCalledWith(8)

    await button(wrapper, 'Вставить кадр').trigger('click')
    expect(editor.insertFrame).toHaveBeenCalledTimes(1)
  })

  it('shows looping only for gestures and keeps the other visible properties', () => {
    const gesture = createCpmEditorMock()
    const gestureWrapper = mountTools(gesture)
    const loop = checkbox(gestureWrapper, 'Зацикливание')
    expect(loop).toBeDefined()

    const setup = createCpmEditorMockWith('gesture', {
      animationData: computed(() => ({
        id: 'g_wave.json',
        name: 'Машет',
        kind: 'setup' as const,
        duration: 1000,
        priority: 0,
        loop: false,
        additive: false,
        interpolator: 'linear_loop' as const,
        hidden: false,
      })),
    })
    const setupWrapper = mountTools(setup)
    expect(checkbox(setupWrapper, 'Зацикливание')).toBeUndefined()
    expect(checkbox(setupWrapper, 'Аддитивность')).toBeDefined()
    expect(setupWrapper.find('.cpm-props__interpolator').exists()).toBe(true)
  })

  it('edits the advanced properties', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const advanced = wrapper.find('.cpm-props__advanced')
    expect(advanced.text()).toContain('Продвинутое')

    const priority = wrapper.find('[aria-label="Приоритет"]')
    await priority.setValue('3')
    await priority.trigger('change')
    expect(editor.setPriority).toHaveBeenCalledWith(3)

    const order = wrapper.find('[aria-label="Порядок"]')
    await order.setValue('2')
    await order.trigger('change')
    expect(editor.setOrder).toHaveBeenCalledWith(2)

    const group = wrapper.find('[aria-label="Группа"]')
    await group.setValue('Основная')
    await group.trigger('change')
    expect(editor.setGroup).toHaveBeenCalledWith('Основная')

    const setCheckbox = async (label: string): Promise<void> => {
      const row = wrapper.findAll('.checkbox').find((item) => item.text() === label)
      if (!row) throw new Error(`Нет чекбокса «${label}»`)
      await row.find('.checkbox__input').setValue(true)
    }

    await setCheckbox('До конца')
    expect(editor.setMustFinish).toHaveBeenCalledWith(true)
    await setCheckbox('Команда')
    expect(editor.setCommand).toHaveBeenCalledWith(true)
    await setCheckbox('Скрыта')
    expect(editor.setHidden).toHaveBeenCalledWith(true)
  })

  it('toggles the vanilla preview', async () => {
    const editor = createCpmEditorMockWith('vanilla-pose')
    const wrapper = mountTools(editor)

    const preview = checkbox(wrapper, 'Превью')
    expect(preview).toBeDefined()
    await preview?.setValue(false)

    expect(editor.setPreviewEnabled).toHaveBeenCalledWith(false)
  })

  it('applies the bone visibility toggle', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    await wrapper.find('.checkbox__input').setValue(false)

    expect(editor.setBoneVisible).toHaveBeenCalledWith(false)
  })

  it('mirrors and smooths the selected bone', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const actions = wrapper.findAll('.cpm-pose__action')
    await actions[0]?.trigger('click')
    await actions[1]?.trigger('click')
    await actions[2]?.trigger('click')

    expect(editor.revertBoneStep).toHaveBeenCalledTimes(1)
    expect(editor.mirrorPose).toHaveBeenCalledTimes(1)
    expect(editor.smoothTrack).toHaveBeenCalledTimes(1)
  })

  it('disables the step-back action without a previous change', () => {
    const editor = createCpmEditorMock({ canRevertBoneStep: computed(() => false) })
    const wrapper = mountTools(editor)

    const action = wrapper.find('[aria-label="Вернуть к предыдущему шагу"]')
    expect(action.attributes('disabled')).toBeDefined()
  })

  it('switches the rotation pivot between the base and the tip', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const buttons = wrapper.findAll('.cpm-pose__pivot-btn')
    expect(buttons.map((item) => item.text())).toEqual(['Основание', 'Кончик'])
    await buttons[1]?.trigger('click')
    expect(editor.setRotationPivot).toHaveBeenCalledWith('tip')

    editor.rotationPivot.value = 'tip'
    await wrapper.vm.$nextTick()
    const hints = wrapper.findAll('.cpm-pose__hint').map((item) => item.text())
    expect(hints.some((text) => text.includes('кончик'))).toBe(true)
  })

  it('configures the number of ghost frames before and after the current one', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const before = wrapper.find('[aria-label="Кадров до текущего"]')
    await before.setValue('3')
    await before.trigger('change')
    expect(editor.setGhostFrames).toHaveBeenCalledWith(3, 2)

    const after = wrapper.find('[aria-label="Кадров после текущего"]')
    await after.setValue('0')
    await after.trigger('change')
    expect(editor.setGhostFrames).toHaveBeenLastCalledWith(2, 0)
  })

  it('inserts an intermediate pose at the configured fraction', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTools(editor)

    const insert = wrapper.findAll('button').find((item) => item.text() === 'Вставить позу')
    await insert?.trigger('click')
    expect(editor.insertPoseAtFraction).toHaveBeenCalledWith(0.5)

    const fraction = wrapper.find('[aria-label="Доля пути между ключами"]')
    await fraction.setValue('0.3')
    await fraction.trigger('change')
    await insert?.trigger('click')
    expect(editor.insertPoseAtFraction).toHaveBeenLastCalledWith(0.3)
  })

  it('collapses and expands the settings panel', async () => {
    const wrapper = mountTools(createCpmEditorMock())
    const collapse = button(wrapper, 'Скрыть настройки')
    expect(collapse.attributes('aria-expanded')).toBe('true')

    await collapse.trigger('click')

    expect(wrapper.find('.cpm-editor-tools--collapsed').exists()).toBe(true)
    expect(button(wrapper, 'Показать настройки').attributes('aria-expanded')).toBe('false')
    expect((wrapper.find('.cpm-editor-tools__body').element as HTMLElement).style.display).toBe('none')

    await button(wrapper, 'Показать настройки').trigger('click')

    expect(wrapper.find('.cpm-editor-tools--collapsed').exists()).toBe(false)
    expect((wrapper.find('.cpm-editor-tools__body').element as HTMLElement).style.display).toBe('')
  })
})

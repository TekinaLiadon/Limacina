import { describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createCpmEditorBridge, type CpmAnimationEditorApi } from '@/04-features'
import CpmAnimationEditor from '../CpmAnimationEditor.vue'

const animation = {
  id: 'g_wave.json',
  name: 'Машет',
  kind: 'gesture' as const,
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop' as const,
  hidden: false,
  frames: [],
}

const pose = {
  rotation: { x: 0, y: 30, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  show: true,
}

const makeEditor = (overrides: Partial<CpmAnimationEditorApi> = {}): CpmAnimationEditorApi => ({
  isEditing: ref(true),
  isDirty: computed(() => false),
  animation: computed(() => animation),
  animationData: computed(() => {
    const { frames: _frames, ...data } = animation
    return data
  }),
  activeAnimations: computed(() => []),
  kindLabel: computed(() => 'Жест'),
  vanillaPoseIndex: computed(() => null),
  vanillaPoseHint: computed(() => null),
  isPreviewEnabled: ref(true),
  saveErrors: computed(() => []),
  saveWarnings: computed(() => []),
  frameCount: computed(() => 6),
  currentFrame: ref(2),
  isPlaying: ref(false),
  canUndo: computed(() => true),
  canRedo: computed(() => false),
  selectedBoneId: ref(0),
  boneRows: computed(() => [
    { storeId: 0, name: 'Голова', depth: 0 },
    { storeId: 100, name: 'Шляпа', depth: 1 },
  ]),
  selectedBoneName: computed(() => 'Голова'),
  selectedBonePose: computed(() => pose),
  selectedBoneKeys: computed(() => [0, 4]),
  isKeyAtCurrentFrame: computed(() => false),
  canAddKey: computed(() => true),
  canRemoveKey: computed(() => false),
  canCopyKey: computed(() => true),
  canPasteKey: computed(() => false),
  canMirrorPose: computed(() => true),
  canSmoothTrack: computed(() => true),
  canRevertBoneStep: computed(() => true),
  canJumpToPreviousKey: computed(() => false),
  canJumpToNextKey: computed(() => true),
  ghostBefore: ref(2),
  ghostAfter: ref(2),
  beadMode: ref<'single' | 'proportional'>('single'),
  timeBeads: computed(() => [{ fromFrame: 0, toFrame: 4 }]),
  isSimpleMode: ref(false),
  simpleFrames: computed(() => [
    { frame: 0, seconds: 0 },
    { frame: 5, seconds: 1 },
  ]),
  editFrame: computed(() => 2),
  rotationPivot: ref<'base' | 'tip'>('base'),
  weight: shallowRef(null),
  isWeightLoading: ref(false),
  weightError: ref(''),
  startEditing: vi.fn(),
  stopEditing: vi.fn().mockResolvedValue(true),
  confirmLeave: vi.fn().mockResolvedValue(true),
  prepareSave: vi.fn().mockReturnValue(true),
  markSaved: vi.fn(),
  refreshWeight: vi.fn().mockResolvedValue(undefined),
  selectBone: vi.fn(),
  setBoneRotation: vi.fn(),
  setBonePosition: vi.fn(),
  setBoneVisible: vi.fn(),
  setName: vi.fn(),
  setKind: vi.fn(),
  setVanillaPose: vi.fn(),
  setDuration: vi.fn(),
  setFrameCount: vi.fn().mockResolvedValue(true),
  insertFrame: vi.fn(),
  setLoop: vi.fn(),
  setAdditive: vi.fn(),
  setInterpolator: vi.fn(),
  setPriority: vi.fn(),
  setOrder: vi.fn(),
  setGroup: vi.fn(),
  setMustFinish: vi.fn(),
  setCommand: vi.fn(),
  setHidden: vi.fn(),
  setPreviewEnabled: vi.fn(),
  deleteCurrentAnimation: vi.fn().mockResolvedValue(true),
  setGhostFrames: vi.fn(),
  setBeadMode: vi.fn(),
  setSimpleMode: vi.fn(),
  goToSecond: vi.fn(),
  setRotationPivot: vi.fn(),
  beginBeadDrag: vi.fn(),
  dragBead: vi.fn(),
  endBeadDrag: vi.fn(),
  beginBoneDrag: vi.fn(),
  dragBoneRotation: vi.fn(),
  dragBoneTranslation: vi.fn(),
  endBoneDrag: vi.fn(),
  addKey: vi.fn(),
  removeKey: vi.fn(),
  copyKey: vi.fn(),
  pasteKey: vi.fn(),
  mirrorPose: vi.fn(),
  smoothTrack: vi.fn(),
  revertBoneStep: vi.fn(),
  insertPoseAtFraction: vi.fn(),
  togglePlayback: vi.fn(),
  setPlaying: vi.fn(),
  stepFrame: vi.fn(),
  goToFrame: vi.fn(),
  jumpToKey: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  ...overrides,
})

const animationOf = (kind: 'gesture' | 'vanilla-pose', name = 'Машет') => ({
  ...animation,
  kind,
  name,
})

const makeEditorWith = (
  kind: 'gesture' | 'vanilla-pose',
  overrides: Partial<CpmAnimationEditorApi> = {},
): CpmAnimationEditorApi => makeEditor({
  animation: computed(() => animationOf(kind)),
  animationData: computed(() => {
    const { frames: _frames, ...data } = animationOf(kind)
    return kind === 'vanilla-pose' ? { ...data, poseIndex: 3 } : data
  }),
  vanillaPoseIndex: computed(() => (kind === 'vanilla-pose' ? 3 : null)),
  ...overrides,
})

const mountEditor = (editor: CpmAnimationEditorApi): VueWrapper =>
  mount(CpmAnimationEditor, {
    props: {
      editor,
      bridge: createCpmEditorBridge(),
      speed: 1,
      canSpeedDown: true,
      canSpeedUp: true,
      isLooped: false,
    },
  })

const button = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> =>
  wrapper.find(`[aria-label="${label}"]`)

const checkbox = (
  wrapper: VueWrapper,
  label: string,
): ReturnType<VueWrapper['find']> | undefined => {
  const row = wrapper.findAll('.checkbox').find((item) => item.text() === label)
  return row?.find('.checkbox__input')
}

describe('CpmAnimationEditor', () => {
  it('renders the animation name, trigger, frame position and keys', () => {
    const wrapper = mountEditor(makeEditor())

    expect((wrapper.find('[aria-label="Имя анимации"]').element as HTMLInputElement).value).toBe('Машет')
    expect(wrapper.find('.cpm-props__trigger .select-base__title').text()).toBe('Жест')
    expect(wrapper.find('.cpm-timeline__number input').element).toHaveProperty('value', '3')
    expect(wrapper.findAll('.cpm-timeline__cell--key')).toHaveLength(2)
    expect(wrapper.findAll('.cpm-timeline__cell--active')).toHaveLength(1)
  })

  it('selects bones from the tree', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const rows = wrapper.findAll('.cpm-bone-tree__row')
    expect(rows).toHaveLength(2)
    await rows[1]?.trigger('click')

    expect(editor.selectBone).toHaveBeenCalledWith(100)
    expect(rows[0]?.attributes('aria-selected')).toBe('true')
    expect(rows[1]?.attributes('aria-level')).toBe('2')
  })

  it('applies numeric rotation and position edits', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

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
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const rotation = wrapper.find('[aria-label="Поворот Y"]')
    const field = rotation.element.closest('.cpm-pose__number')
    const up = field?.querySelector<HTMLButtonElement>('[aria-label="Увеличить значение"]')
    up?.click()

    expect(editor.setBoneRotation).toHaveBeenCalledWith('y', 31)
  })

  it('shows an empty state without a selected bone', () => {
    const wrapper = mountEditor(makeEditor({
      selectedBoneId: ref(null),
      selectedBoneName: computed(() => null),
      selectedBonePose: computed(() => null),
    }))

    expect(wrapper.find('.cpm-pose__empty').text()).toContain('Выберите кость')
    expect(wrapper.find('[aria-label="Поворот Y"]').exists()).toBe(false)
  })

  it('renders validation errors as an alert', () => {
    const wrapper = mountEditor(makeEditor({
      saveErrors: computed(() => ['Имя анимации не может быть пустым']),
    }))

    expect(wrapper.find('[role="alert"]').text()).toContain('Имя анимации не может быть пустым')
  })

  it('wires the playback and key controls', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    await button(wrapper, 'Воспроизвести').trigger('click')
    await button(wrapper, 'Предыдущий кадр').trigger('click')
    await button(wrapper, 'Следующий кадр').trigger('click')
    await button(wrapper, 'Следующий ключ').trigger('click')
    await button(wrapper, 'Поставить ключ').trigger('click')
    await button(wrapper, 'Отменить').trigger('click')
    const finishButton = wrapper.findAll('button').find((item) => item.text() === 'Завершить')
    await finishButton?.trigger('click')

    expect(editor.togglePlayback).toHaveBeenCalledTimes(1)
    expect(editor.stepFrame).toHaveBeenNthCalledWith(1, -1)
    expect(editor.stepFrame).toHaveBeenNthCalledWith(2, 1)
    expect(editor.jumpToKey).toHaveBeenCalledWith(1)
    expect(editor.addKey).toHaveBeenCalledTimes(1)
    expect(editor.undo).toHaveBeenCalledTimes(1)
    expect(editor.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('disables the key and history actions according to the session state', () => {
    const wrapper = mountEditor(makeEditor())

    expect(button(wrapper, 'Повторить').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Предыдущий ключ').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Удалить ключ').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Следующий ключ').attributes('disabled')).toBeUndefined()
  })

  it('moves the playhead from the ruler and the frame input', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const cells = wrapper.findAll('.cpm-timeline__cell')
    await cells[4]?.trigger('click')
    expect(editor.goToFrame).toHaveBeenCalledWith(4)

    const frameInput = wrapper.find('.cpm-timeline__number input')
    await frameInput.setValue('6')
    await frameInput.trigger('change')
    expect(editor.goToFrame).toHaveBeenLastCalledWith(5)
  })

  it('renames the animation and applies visibility', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const nameInput = wrapper.find('.cpm-editor__input')
    await nameInput.setValue('Приветствие')
    await nameInput.trigger('change')
    expect(editor.setName).toHaveBeenCalledWith('Приветствие')

    await wrapper.find('.checkbox__input').setValue(false)
    expect(editor.setBoneVisible).toHaveBeenCalledWith(false)
  })

  it('configures the number of ghost frames before and after the current one', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const before = wrapper.find('[aria-label="Кадров до текущего"]')
    await before.setValue('3')
    await before.trigger('change')
    expect(editor.setGhostFrames).toHaveBeenCalledWith(3, 2)

    const after = wrapper.find('[aria-label="Кадров после текущего"]')
    await after.setValue('0')
    await after.trigger('change')
    expect(editor.setGhostFrames).toHaveBeenLastCalledWith(2, 0)
  })

  it('switches the bead shift mode', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const modes = wrapper.findAll('.cpm-timeline__mode-btn')
    expect(modes).toHaveLength(2)
    await modes[1]?.trigger('click')

    expect(editor.setBeadMode).toHaveBeenCalledWith('proportional')
  })

  it('switches to the simple second-based mode', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const modes = wrapper.findAll('.cpm-timeline__edit-btn')
    expect(modes.map((item) => item.text())).toEqual(['Простой', 'Покадровый'])
    await modes[0]?.trigger('click')
    expect(editor.setSimpleMode).toHaveBeenCalledWith(true)

    editor.isSimpleMode.value = true
    await wrapper.vm.$nextTick()

    const cells = wrapper.findAll('.cpm-timeline__cell')
    expect(cells).toHaveLength(2)
    expect(cells.map((item) => item.text())).toEqual(['0 с', '1 с'])
    expect(wrapper.find('[aria-label="Номер кадра"]').exists()).toBe(false)

    await cells[1]?.trigger('click')
    expect(editor.goToFrame).toHaveBeenCalledWith(5)

    const seconds = wrapper.find('[aria-label="Секунда"]')
    await seconds.setValue('1')
    await seconds.trigger('change')
    expect(editor.goToSecond).toHaveBeenCalledWith(1)

    expect(wrapper.find('.cpm-editor__hint').text()).toContain('Позы ставятся на границах секунд')
  })

  it('renders time beads and nudges them with the keyboard', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const bead = wrapper.find('.cpm-timeline__bead')
    expect(bead.exists()).toBe(true)
    expect(bead.attributes('title')).toContain('Сдвинуть ключ')

    await bead.trigger('keydown', { key: 'ArrowRight' })

    expect(editor.beginBeadDrag).toHaveBeenCalledWith(0, 4)
    expect(editor.dragBead).toHaveBeenCalledWith(1)
    expect(editor.endBeadDrag).toHaveBeenCalledTimes(1)
  })

  it('changes the trigger from the properties form', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

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
    const editor = makeEditorWith('vanilla-pose')
    const wrapper = mountEditor(editor)

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
    const wrapper = mountEditor(makeEditorWith('vanilla-pose', {
      vanillaPoseHint: computed(() => 'Длительность работает как множитель'),
    }))

    expect(wrapper.find('.cpm-props__hint').text()).toContain('множитель')
  })

  it('keeps the name input readonly for a vanilla pose', () => {
    const wrapper = mountEditor(makeEditorWith('vanilla-pose'))

    expect(wrapper.find('[aria-label="Имя анимации"]').attributes('readonly')).toBeDefined()
  })

  it('updates the duration and the frame count', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

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

  it('shows looping only for gestures and keeps the other visible properties', async () => {
    const gesture = makeEditor()
    const gestureWrapper = mountEditor(gesture)
    const loop = checkbox(gestureWrapper, 'Зацикливание')
    expect(loop).toBeDefined()
    await loop?.setValue(true)
    expect(gesture.setLoop).toHaveBeenCalledWith(true)

    const setup = makeEditorWith('gesture', {
      animationData: computed(() => ({ ...animation, kind: 'setup' as const })),
    })
    const setupWrapper = mountEditor(setup)
    expect(checkbox(setupWrapper, 'Зацикливание')).toBeUndefined()
    expect(checkbox(setupWrapper, 'Аддитивность')).toBeDefined()
    expect(setupWrapper.find('.cpm-props__interpolator').exists()).toBe(true)
  })

  it('edits the advanced properties', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

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

  it('renders the linear transition warning', () => {
    const wrapper = mountEditor(makeEditor({
      saveWarnings: computed(() => ['Линейный интерполятор при заметной разнице между соседними ключами даёт механический переход']),
    }))

    expect(wrapper.find('.cpm-editor__warning').text()).toContain('механический')
  })

  it('deletes the animation from the header', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    await button(wrapper, 'Удалить анимацию').trigger('click')

    expect(editor.deleteCurrentAnimation).toHaveBeenCalledTimes(1)
  })

  it('toggles the vanilla preview', async () => {
    const editor = makeEditorWith('vanilla-pose')
    const wrapper = mountEditor(editor)

    const preview = checkbox(wrapper, 'Превью')
    expect(preview).toBeDefined()
    await preview?.setValue(false)

    expect(editor.setPreviewEnabled).toHaveBeenCalledWith(false)
  })

  it('copies and pastes a key from the timeline', async () => {
    const editor = makeEditor({ canPasteKey: computed(() => true) })
    const wrapper = mountEditor(editor)

    await button(wrapper, 'Копировать ключ').trigger('click')
    await button(wrapper, 'Вставить ключ').trigger('click')

    expect(editor.copyKey).toHaveBeenCalledTimes(1)
    expect(editor.pasteKey).toHaveBeenCalledTimes(1)
  })

  it('changes playback speed and looping from the editor timeline', async () => {
    const wrapper = mountEditor(makeEditor())

    await button(wrapper, 'Медленнее').trigger('click')
    await button(wrapper, 'Быстрее').trigger('click')
    await button(wrapper, 'Зацикливание').trigger('click')

    expect(wrapper.emitted('speed-down')).toHaveLength(1)
    expect(wrapper.emitted('speed-up')).toHaveLength(1)
    expect(wrapper.emitted('toggle-loop')).toHaveLength(1)
    expect(wrapper.find('.cpm-timeline__speed').text()).toBe('1×')
  })

  it('mirrors and smooths the selected bone', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const actions = wrapper.findAll('.cpm-pose__action')
    await actions[0]?.trigger('click')
    await actions[1]?.trigger('click')
    await actions[2]?.trigger('click')

    expect(editor.revertBoneStep).toHaveBeenCalledTimes(1)
    expect(editor.mirrorPose).toHaveBeenCalledTimes(1)
    expect(editor.smoothTrack).toHaveBeenCalledTimes(1)
  })

  it('disables the step-back action without a previous change', () => {
    const editor = makeEditor({ canRevertBoneStep: computed(() => false) })
    const wrapper = mountEditor(editor)

    const action = wrapper.find('[aria-label="Вернуть к предыдущему шагу"]')
    expect(action.attributes('disabled')).toBeDefined()
  })

  it('switches the rotation pivot between the base and the tip', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const buttons = wrapper.findAll('.cpm-pose__pivot-btn')
    expect(buttons.map((item) => item.text())).toEqual(['Основание', 'Кончик'])
    await buttons[1]?.trigger('click')
    expect(editor.setRotationPivot).toHaveBeenCalledWith('tip')

    editor.rotationPivot.value = 'tip'
    await wrapper.vm.$nextTick()
    const hints = wrapper.findAll('.cpm-pose__hint').map((item) => item.text())
    expect(hints.some((text) => text.includes('кончик'))).toBe(true)
  })

  it('inserts an intermediate pose at the configured fraction', async () => {
    const editor = makeEditor()
    const wrapper = mountEditor(editor)

    const insert = wrapper.findAll('button').find((item) => item.text() === 'Вставить позу')
    await insert?.trigger('click')
    expect(editor.insertPoseAtFraction).toHaveBeenCalledWith(0.5)

    const fraction = wrapper.find('[aria-label="Доля пути между ключами"]')
    await fraction.setValue('0.3')
    await fraction.trigger('change')
    await insert?.trigger('click')
    expect(editor.insertPoseAtFraction).toHaveBeenLastCalledWith(0.3)
  })
})

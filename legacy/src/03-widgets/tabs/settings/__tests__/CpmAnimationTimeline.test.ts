import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import CpmAnimationTimeline from '../cpm-animation-editor/CpmAnimationTimeline.vue'
import { createCpmEditorMock } from '@/test-support/cpmEditorMock'
import type { CpmAnimationEditorApi } from '@/04-features'

const mountTimeline = (editor: CpmAnimationEditorApi): VueWrapper =>
  mount(CpmAnimationTimeline, {
    props: {
      editor,
      speed: 1,
      canSpeedDown: true,
      canSpeedUp: true,
      isLooped: false,
    },
  })

const button = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> =>
  wrapper.find(`[aria-label="${label}"]`)

const stubContentRect = (wrapper: VueWrapper): void => {
  const content = wrapper.find('.cpm-timeline__content').element as HTMLElement
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 120,
    bottom: 0,
    width: 120,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

describe('CpmAnimationTimeline', () => {
  it('renders the frame position, markers and keys', () => {
    const wrapper = mountTimeline(createCpmEditorMock())

    expect(wrapper.find('.cpm-timeline__number input').element).toHaveProperty('value', '3')
    expect(wrapper.findAll('.cpm-timeline__marker')).toHaveLength(6)
    expect(wrapper.findAll('.cpm-timeline__marker--key')).toHaveLength(2)
    expect(wrapper.findAll('.cpm-timeline__marker--active')).toHaveLength(1)
    expect(wrapper.find('.cpm-timeline__playhead').attributes('style')).toContain('left: 56px')
    expect(wrapper.findAll('.cpm-timeline__tick-label').map((item) => item.text()))
      .toEqual(['0', '0.5 с', '1 с'])
  })

  it('wires the playback and key controls', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    await button(wrapper, 'Воспроизвести').trigger('click')
    await button(wrapper, 'Предыдущий кадр').trigger('click')
    await button(wrapper, 'Следующий кадр').trigger('click')
    await button(wrapper, 'Следующий ключ').trigger('click')
    await button(wrapper, 'Поставить ключ').trigger('click')
    await button(wrapper, 'Отменить').trigger('click')

    expect(editor.togglePlayback).toHaveBeenCalledTimes(1)
    expect(editor.stepFrame).toHaveBeenNthCalledWith(1, -1)
    expect(editor.stepFrame).toHaveBeenNthCalledWith(2, 1)
    expect(editor.jumpToKey).toHaveBeenCalledWith(1)
    expect(editor.addKey).toHaveBeenCalledTimes(1)
    expect(editor.undo).toHaveBeenCalledTimes(1)
    expect(button(wrapper, 'Поставить ключ').attributes('title')).toBe('Поставить ключ')
  })

  it('disables the key and history actions according to the session state', () => {
    const wrapper = mountTimeline(createCpmEditorMock())

    expect(button(wrapper, 'Повторить').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Предыдущий ключ').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Удалить ключ').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Следующий ключ').attributes('disabled')).toBeUndefined()
  })

  it('moves the playhead from the markers and the frame input', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    const markers = wrapper.findAll('.cpm-timeline__marker')
    await markers[4]?.trigger('click')
    expect(editor.goToFrame).toHaveBeenCalledWith(4)

    const frameInput = wrapper.find('.cpm-timeline__number input')
    await frameInput.setValue('6')
    await frameInput.trigger('change')
    expect(editor.goToFrame).toHaveBeenLastCalledWith(5)
  })

  it('switches the bead shift mode', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    const modes = wrapper.findAll('.cpm-timeline__mode-btn')
    expect(modes).toHaveLength(2)
    await modes[1]?.trigger('click')

    expect(editor.setBeadMode).toHaveBeenCalledWith('proportional')
  })

  it('adds a frame in frame mode and a step in simple mode', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    const frameButton = button(wrapper, 'Вставить кадр')
    expect(frameButton.text()).toBe('+ кадр')
    await frameButton.trigger('click')
    expect(editor.insertFrame).toHaveBeenCalledTimes(1)
    expect(editor.insertStep).not.toHaveBeenCalled()

    editor.isSimpleMode.value = true
    await wrapper.vm.$nextTick()

    expect(button(wrapper, 'Вставить кадр').exists()).toBe(false)
    const stepButton = button(wrapper, 'Добавить полсекунды')
    expect(stepButton.text()).toBe('+ 0,5 с')
    await stepButton.trigger('click')
    expect(editor.insertStep).toHaveBeenCalledTimes(1)
    expect(editor.insertFrame).toHaveBeenCalledTimes(1)
  })

  it('switches to the simple step-based mode', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    const modes = wrapper.findAll('.cpm-timeline__edit-btn')
    expect(modes.map((item) => item.text())).toEqual(['Простой', 'Покадровый'])
    await modes[0]?.trigger('click')
    expect(editor.setSimpleMode).toHaveBeenCalledWith(true)

    editor.isSimpleMode.value = true
    await wrapper.vm.$nextTick()

    const markers = wrapper.findAll('.cpm-timeline__marker')
    expect(markers).toHaveLength(3)
    expect(markers.map((item) => item.attributes('aria-label')))
      .toEqual(['0 с, ключ', '0.5 с', '1 с'])
    expect(wrapper.find('[aria-label="Номер кадра"]').exists()).toBe(false)

    await markers[1]?.trigger('click')
    expect(editor.goToFrame).toHaveBeenCalledWith(3)

    const seconds = wrapper.find('[aria-label="Секунда"]')
    await seconds.setValue('1')
    await seconds.trigger('change')
    expect(editor.goToSecond).toHaveBeenCalledWith(1)

    expect(modes[0]?.attributes('title')).toContain('Позы ставятся каждые 0,5 секунды')
  })

  it('scrubs the animation from the ruler', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)
    stubContentRect(wrapper)

    const ruler = wrapper.find('.cpm-timeline__ruler')
    ruler.element.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 16,
    }))
    await nextTick()

    expect(editor.beginScrub).toHaveBeenCalledTimes(1)
    expect(editor.scrubTo).toHaveBeenLastCalledWith(0)

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 76 }))
    await nextTick()
    expect(editor.scrubTo).toHaveBeenLastCalledWith(0.5)

    window.dispatchEvent(new MouseEvent('pointerup'))
    await nextTick()
    expect(editor.endScrub).toHaveBeenCalledTimes(1)
  })

  it('reorders a frame with drag and drop', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)
    stubContentRect(wrapper)

    const [marker] = wrapper.findAll('.cpm-timeline__marker')
    marker?.element.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 16,
    }))
    await nextTick()

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 76 }))
    await nextTick()
    window.dispatchEvent(new MouseEvent('pointerup'))
    await nextTick()

    expect(editor.moveFrame).toHaveBeenCalledWith(0, 3)
  })

  it('paints the current frame from the palette', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    await button(wrapper, 'Цвет кадра не задан').trigger('click')
    await nextTick()
    await button(wrapper, 'Красный').trigger('click')

    expect(editor.setFrameColor).toHaveBeenCalledWith(2, '#ef4444')
  })

  it('zooms the timeline', async () => {
    const wrapper = mountTimeline(createCpmEditorMock())
    expect(wrapper.find('.cpm-timeline__zoom-value').text()).toBe('100%')

    await button(wrapper, 'Увеличить масштаб').trigger('click')
    expect(wrapper.find('.cpm-timeline__zoom-value').text()).toBe('120%')

    await button(wrapper, 'Уменьшить масштаб').trigger('click')
    expect(wrapper.find('.cpm-timeline__zoom-value').text()).toBe('100%')
  })

  it('renders time beads and nudges them with the keyboard', async () => {    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)

    const bead = wrapper.find('.cpm-timeline__bead')
    expect(bead.exists()).toBe(true)
    expect(bead.attributes('title')).toContain('Сдвинуть ключ')

    await bead.trigger('keydown', { key: 'ArrowRight' })

    expect(editor.beginBeadDrag).toHaveBeenCalledWith(0, 4)
    expect(editor.dragBead).toHaveBeenCalledWith(1)
    expect(editor.endBeadDrag).toHaveBeenCalledTimes(1)
  })

  it('copies and pastes a key from the timeline', async () => {
    const editor = createCpmEditorMock({ canPasteKey: computed(() => true) })
    const wrapper = mountTimeline(editor)

    await button(wrapper, 'Копировать ключ').trigger('click')
    await button(wrapper, 'Вставить ключ').trigger('click')

    expect(editor.copyKey).toHaveBeenCalledTimes(1)
    expect(editor.pasteKey).toHaveBeenCalledTimes(1)
  })

  it('changes playback speed and looping', async () => {
    const wrapper = mountTimeline(createCpmEditorMock())

    await button(wrapper, 'Медленнее').trigger('click')
    await button(wrapper, 'Быстрее').trigger('click')
    await button(wrapper, 'Зацикливание').trigger('click')

    expect(wrapper.emitted('speed-down')).toHaveLength(1)
    expect(wrapper.emitted('speed-up')).toHaveLength(1)
    expect(wrapper.emitted('toggle-loop')).toHaveLength(1)
    expect(wrapper.find('.cpm-timeline__speed').text()).toBe('1×')
  })

  it('collapses the frame work but keeps the playback summary', async () => {
    const editor = createCpmEditorMock()
    const wrapper = mountTimeline(editor)
    const collapse = button(wrapper, 'Скрыть кадры')
    expect(collapse.attributes('aria-expanded')).toBe('true')

    await collapse.trigger('click')

    expect(wrapper.find('.cpm-editor-timeline--collapsed').exists()).toBe(true)
    expect((wrapper.find('.cpm-editor-timeline__body').element as HTMLElement).style.display).toBe('none')
    expect(button(wrapper, 'Показать кадры').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.cpm-editor-timeline__frame').text()).toBe('3 / 6')

    await button(wrapper, 'Воспроизвести').trigger('click')
    expect(editor.togglePlayback).toHaveBeenCalledTimes(1)

    await button(wrapper, 'Показать кадры').trigger('click')
    expect(wrapper.find('.cpm-editor-timeline--collapsed').exists()).toBe(false)
    expect((wrapper.find('.cpm-editor-timeline__body').element as HTMLElement).style.display).toBe('')
  })
})

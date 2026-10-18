import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { CpmTabbedPanelData } from '../cpmTabbedPanel'
import CpmAnimationPanel from '../CpmAnimationPanel.vue'

const data: CpmTabbedPanelData = {
  tabs: ['Голова', 'Тело', 'Без группы'],
  'Голова': [
    { id: 'head-helmet', label: 'Шлем' },
    { id: 'head-glasses', label: 'Очки' },
  ],
  'Тело': [
    { id: 'body-cape', label: 'Плащ' },
  ],
  'Без группы': [
    { id: 'misc-glow', label: 'Свечение' },
  ],
}

interface PanelOverrides {
  data?: CpmTabbedPanelData
  hasAnimation?: boolean
  isPlaying?: boolean
  isLooped?: boolean
  speed?: number
  canSpeedDown?: boolean
  canSpeedUp?: boolean
}

const mountPanel = (
  modelValue: string[] = ['head-helmet'],
  overrides: PanelOverrides = {},
): VueWrapper => mount(CpmAnimationPanel, {
  props: {
    data,
    modelValue,
    hasAnimation: true,
    isPlaying: false,
    isLooped: false,
    speed: 1,
    canSpeedDown: true,
    canSpeedUp: true,
    ...overrides,
  },
})

const filterButton = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> | undefined =>
  wrapper.findAll('.cpm-tabbed-panel__filter').find((node) => node.text().startsWith(label))

const item = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> | undefined =>
  wrapper.findAll('.cpm-tabbed-panel__item').find((node) => node.text() === label)

describe('CpmAnimationPanel', () => {
  it('renders group filters with selected counts and opens the first group', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.cpm-tabbed-panel__count').text()).toBe('Выбрано: 1 из 4')
    const filters = wrapper.findAll('.cpm-tabbed-panel__filter')
    expect(filters.map((node) => node.find('.cpm-tabbed-panel__filter-label').text())).toEqual([
      'Голова',
      'Тело',
      'Без группы',
    ])
    expect(filters.map((node) => node.find('.cpm-tabbed-panel__filter-count').text())).toEqual([
      '1/2',
      '0/1',
      '0/1',
    ])
    expect(filters[0]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.cpm-tabbed-panel__item').map((node) => node.text())).toEqual([
      'Шлем',
      'Очки',
    ])
  })

  it('switches to another group through the filter', async () => {
    const wrapper = mountPanel()

    await filterButton(wrapper, 'Тело')?.trigger('click')

    expect(filterButton(wrapper, 'Тело')?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.cpm-tabbed-panel__item').map((node) => node.text())).toEqual([
      'Плащ',
    ])
  })

  it('appends a selected animation to the end of the selection', async () => {
    const wrapper = mountPanel()
    const glasses = item(wrapper, 'Очки')
    if (!glasses) throw new Error('Нет анимации «Очки»')

    await glasses.find('.checkbox__input').setValue(true)

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      ['head-helmet', 'head-glasses'],
    ])
  })

  it('removes an already selected animation', async () => {
    const wrapper = mountPanel(['head-helmet', 'head-glasses'])
    const helmet = item(wrapper, 'Шлем')
    if (!helmet) throw new Error('Нет анимации «Шлем»')

    await helmet.find('.checkbox__input').setValue(false)

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      ['head-glasses'],
    ])
  })

  it('shows the selected animations in their selection order and removes them from the tray', async () => {
    const wrapper = mountPanel(['body-cape', 'head-helmet'])

    const chips = wrapper.findAll('.cpm-tabbed-panel__selected')
    expect(chips.map((node) => node.find('.cpm-tabbed-panel__selected-name').text())).toEqual([
      'Плащ',
      'Шлем',
    ])

    await chips[0]?.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      ['head-helmet'],
    ])
  })

  it('clears the whole selection', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.cpm-animation-panel__clear').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[]])
  })

  it('emits playback and speed actions', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[aria-label="Воспроизвести"]').trigger('click')
    await wrapper.find('[aria-label="Повторять анимацию"]').trigger('click')
    await wrapper.find('[aria-label="Замедлить анимацию"]').trigger('click')
    await wrapper.find('[aria-label="Ускорить анимацию"]').trigger('click')

    expect(wrapper.emitted('toggle-play')).toHaveLength(1)
    expect(wrapper.emitted('toggle-loop')).toHaveLength(1)
    expect(wrapper.emitted('speed-down')).toHaveLength(1)
    expect(wrapper.emitted('speed-up')).toHaveLength(1)
  })

  it('disables playback without an active animation', () => {
    const wrapper = mountPanel([], { hasAnimation: false })

    expect(wrapper.find('[aria-label="Воспроизвести"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[aria-label="Повторять анимацию"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.cpm-animation-panel__clear').attributes('disabled')).toBeDefined()
  })

  it('renders header actions from the slot', () => {
    const wrapper = mount(CpmAnimationPanel, {
      props: {
        data,
        modelValue: [],
        hasAnimation: false,
        isPlaying: false,
        isLooped: false,
        speed: 1,
        canSpeedDown: true,
        canSpeedUp: true,
      },
      slots: { actions: '<button class="test-action" type="button">Создать</button>' },
    })

    expect(wrapper.find('.cpm-animation-panel__transport .test-action').text()).toBe('Создать')
  })

  it('opens the first remaining group when the active one disappears', async () => {
    const wrapper = mountPanel()

    await wrapper.setProps({
      data: {
        tabs: ['Тело'],
        'Тело': [{ id: 'body-cape', label: 'Плащ' }],
      },
    })

    expect(wrapper.findAll('.cpm-tabbed-panel__item').map((node) => node.text())).toEqual([
      'Плащ',
    ])
  })

  it('shows an empty state without groups', () => {
    const wrapper = mountPanel([], { data: { tabs: [] } })

    expect(wrapper.findAll('.cpm-tabbed-panel__filter')).toHaveLength(0)
    expect(wrapper.findAll('.cpm-tabbed-panel__item')).toHaveLength(0)
    expect(wrapper.find('.cpm-tabbed-panel__empty').text()).toBe('В модели пока нет анимаций')
    expect(wrapper.find('.cpm-tabbed-panel__tray').exists()).toBe(false)
  })
})

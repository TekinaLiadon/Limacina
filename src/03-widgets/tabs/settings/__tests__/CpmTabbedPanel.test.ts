import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { CpmTabbedPanelData } from '../cpmTabbedPanel'
import CpmTabbedPanel from '../CpmTabbedPanel.vue'

const data: CpmTabbedPanelData = {
  tabs: ['Голова', 'Тело', 'Без группы'],
  'Голова': [
    { id: 'head-helmet', label: 'Шлем' },
    { id: 'head-glasses', label: 'Очки' },
    { id: 'head-locked', label: 'Служебный', disabled: true },
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
  title?: string
  countPrefix?: string
  selectionLabel?: string
  emptyLabel?: string
  emptyDataLabel?: string
  showSelection?: boolean
}

const mountPanel = (
  modelValue: string[] = ['head-helmet'],
  overrides: PanelOverrides = {},
): VueWrapper => mount(CpmTabbedPanel, {
  props: {
    data,
    modelValue,
    title: 'Анимации',
    ...overrides,
  },
})

const filterButton = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> | undefined =>
  wrapper.findAll('.cpm-tabbed-panel__filter').find((node) => node.text().startsWith(label))

const item = (wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> | undefined =>
  wrapper.findAll('.cpm-tabbed-panel__item').find((node) => node.text() === label)

describe('CpmTabbedPanel', () => {
  it('renders the title, counts, tabs and the first tab items', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.cpm-tabbed-panel__title').text()).toContain('Анимации')
    expect(wrapper.find('.cpm-tabbed-panel__count').text()).toBe('Выбрано: 1 из 5')
    const filters = wrapper.findAll('.cpm-tabbed-panel__filter')
    expect(filters.map((node) => node.find('.cpm-tabbed-panel__filter-label').text())).toEqual([
      'Голова',
      'Тело',
      'Без группы',
    ])
    expect(filters.map((node) => node.find('.cpm-tabbed-panel__filter-count').text())).toEqual([
      '1/3',
      '0/1',
      '0/1',
    ])
    expect(filters[0]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.cpm-tabbed-panel__item').map((node) => node.text())).toEqual([
      'Шлем',
      'Очки',
      'Служебный',
    ])
  })

  it('uses the provided count prefix', () => {
    const wrapper = mountPanel([], { title: 'Слои', countPrefix: 'Показано' })

    expect(wrapper.find('.cpm-tabbed-panel__count').text()).toBe('Показано: 0 из 5')
  })

  it('switches the active tab', async () => {
    const wrapper = mountPanel()

    await filterButton(wrapper, 'Тело')?.trigger('click')

    expect(filterButton(wrapper, 'Тело')?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.cpm-tabbed-panel__item').map((node) => node.text())).toEqual([
      'Плащ',
    ])
  })

  it('appends a selected item and removes an already selected one', async () => {
    const wrapper = mountPanel()
    const glasses = item(wrapper, 'Очки')
    if (!glasses) throw new Error('Нет анимации «Очки»')
    await glasses.find('.checkbox__input').setValue(true)

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      ['head-helmet', 'head-glasses'],
    ])

    const removing = mountPanel(['head-helmet', 'head-glasses'])
    const helmet = item(removing, 'Шлем')
    if (!helmet) throw new Error('Нет анимации «Шлем»')
    await helmet.find('.checkbox__input').setValue(false)

    expect(removing.emitted('update:modelValue')?.[0]).toEqual([
      ['head-glasses'],
    ])
  })

  it('does not toggle disabled items', async () => {
    const wrapper = mountPanel(['head-locked'])
    const locked = item(wrapper, 'Служебный')
    if (!locked) throw new Error('Нет анимации «Служебный»')

    expect(locked.find('.checkbox__input').attributes('disabled')).toBeDefined()

    const chip = wrapper.find('.cpm-tabbed-panel__selected')
    await chip.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('shows the selected items in selection order and removes them from the tray', async () => {
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

  it('hides the selection tray when requested', () => {
    const wrapper = mountPanel(['head-helmet'], { showSelection: false })

    expect(wrapper.find('.cpm-tabbed-panel__tray').exists()).toBe(false)
  })

  it('renders the actions slot in the header', () => {
    const wrapper = mount(CpmTabbedPanel, {
      props: { data, modelValue: [], title: 'Анимации' },
      slots: { actions: '<button class="test-action" type="button">Создать</button>' },
    })

    expect(wrapper.find('.cpm-tabbed-panel__actions .test-action').text()).toBe('Создать')
  })

  it('shows the empty data state without tabs', () => {
    const wrapper = mountPanel([], { data: { tabs: [] }, emptyDataLabel: 'В модели нет данных' })

    expect(wrapper.findAll('.cpm-tabbed-panel__filter')).toHaveLength(0)
    expect(wrapper.findAll('.cpm-tabbed-panel__item')).toHaveLength(0)
    expect(wrapper.find('.cpm-tabbed-panel__empty').text()).toBe('В модели нет данных')
    expect(wrapper.find('.cpm-tabbed-panel__tray').exists()).toBe(false)
  })

  it('opens the first remaining tab when the active one disappears', async () => {
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
})

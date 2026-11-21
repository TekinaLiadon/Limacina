import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Component } from 'vue'
import ModelTab from '../ModelTab.vue'
import ModelTabBbmodel from '../model-tab/ModelTabBbmodel.vue'
import ModelTabCpm from '../model-tab/ModelTabCpm.vue'
import ModelTabFigura from '../model-tab/ModelTabFigura.vue'
import { MODEL_TAB_LABELS, SUBTABS_ARIA_LABEL } from '../model-tab/copy'

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({
    onDragDropEvent: async (): Promise<() => void> => () => {},
  }),
}))

enableAutoUnmount(afterEach)

beforeEach((): void => {
  setActivePinia(createPinia())
})

const PANELS: { name: string; component: Component }[] = [
  { name: 'ModelTabCpm', component: ModelTabCpm },
  { name: 'ModelTabBbmodel', component: ModelTabBbmodel },
  { name: 'ModelTabFigura', component: ModelTabFigura },
]

const mountTab = (): VueWrapper => mount(ModelTab, {
  global: {
    stubs: { FiguraViewer: true },
  },
})

const subTabButtons = (wrapper: VueWrapper) =>
  wrapper.findAll('.model-tab__mode-btn')

const activeSubTabLabel = (wrapper: VueWrapper): string =>
  subTabButtons(wrapper).find((button) => button.attributes('aria-pressed') === 'true')?.text() ?? ''

const clickSubTab = async (wrapper: VueWrapper, label: string): Promise<void> => {
  const button = subTabButtons(wrapper).find((item) => item.text() === label)
  if (button === undefined) throw new Error(`кнопка «${label}» не найдена`)
  await button.trigger('click')
}

const mountedPanels = (wrapper: VueWrapper): string[] =>
  PANELS.filter((panel) => wrapper.findComponent(panel.component).exists()).map((panel) => panel.name)

const panelText = (wrapper: VueWrapper, panel: Component): string =>
  wrapper.findComponent(panel).text()

describe('ModelTab', () => {
  it('renders the three sub-tabs in the fixed order', () => {
    const wrapper = mountTab()

    expect(subTabButtons(wrapper).map((button) => button.text())).toEqual([
      MODEL_TAB_LABELS.cpm,
      MODEL_TAB_LABELS.blockbench,
      MODEL_TAB_LABELS.figura,
    ])
  })

  it('describes the sub-tab group for screen readers', () => {
    const wrapper = mountTab()
    const group = wrapper.find('[role="group"]')

    expect(group.attributes('aria-label')).toBe(SUBTABS_ARIA_LABEL)
    expect(group.classes()).toContain('model-tab__modes')
  })

  it('marks every sub-tab button with aria-pressed', () => {
    const wrapper = mountTab()

    expect(subTabButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ])
  })

  it('starts on the cpm sub-tab', () => {
    const wrapper = mountTab()

    expect(activeSubTabLabel(wrapper)).toBe(MODEL_TAB_LABELS.cpm)
    expect(subTabButtons(wrapper)[0]!.classes()).toContain('model-tab__mode-btn--active')
    expect(mountedPanels(wrapper)).toEqual(['ModelTabCpm'])
  })

  it('mounts the blockbench panel and unmounts the cpm panel', async () => {
    const wrapper = mountTab()

    await clickSubTab(wrapper, MODEL_TAB_LABELS.blockbench)

    expect(activeSubTabLabel(wrapper)).toBe(MODEL_TAB_LABELS.blockbench)
    expect(subTabButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(wrapper.findComponent(ModelTabCpm).exists()).toBe(false)
    expect(wrapper.findComponent(ModelTabBbmodel).exists()).toBe(true)
  })

  it('returns to the cpm panel on the second click', async () => {
    const wrapper = mountTab()

    await clickSubTab(wrapper, MODEL_TAB_LABELS.blockbench)
    await clickSubTab(wrapper, MODEL_TAB_LABELS.cpm)

    expect(activeSubTabLabel(wrapper)).toBe(MODEL_TAB_LABELS.cpm)
    expect(wrapper.findComponent(ModelTabCpm).exists()).toBe(true)
    expect(wrapper.findComponent(ModelTabBbmodel).exists()).toBe(false)
  })

  it('keeps exactly one panel mounted on every sub-tab', async () => {
    const wrapper = mountTab()

    for (const subTab of [MODEL_TAB_LABELS.figura, MODEL_TAB_LABELS.blockbench, MODEL_TAB_LABELS.cpm]) {
      await clickSubTab(wrapper, subTab)

      expect(mountedPanels(wrapper)).toHaveLength(1)
    }
  })

  it('gives every sub-tab its own panel content', async () => {
    const wrapper = mountTab()
    const texts: string[] = []

    for (const [label, panel] of [
      [MODEL_TAB_LABELS.cpm, ModelTabCpm],
      [MODEL_TAB_LABELS.blockbench, ModelTabBbmodel],
      [MODEL_TAB_LABELS.figura, ModelTabFigura],
    ] as const) {
      await clickSubTab(wrapper, label)
      texts.push(panelText(wrapper, panel))
    }

    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(texts).size).toBe(texts.length)
  })
})

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import Viewer3D from '../Viewer3D.vue'

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

beforeAll((): void => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: (): Element | null => document.body,
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
})

afterAll((): void => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
  vi.unstubAllGlobals()
})

interface ViewerProps {
  workspace?: boolean
  fullscreen?: boolean
}

const mountViewer = (props: ViewerProps = {}) =>
  mount(Viewer3D, {
    props,
    slots: {
      default: '<div class="fake-canvas" />',
      bottom: '<button type="button" class="fake-bottom-btn">Действие</button>',
    },
    attachTo: document.body,
  })

const mountWorkspace = async (props: ViewerProps = {}): Promise<VueWrapper> => {
  const wrapper = mount(Viewer3D, {
    props: { workspace: true, fullscreen: false, ...props },
    slots: {
      default: '<div class="fake-canvas" />',
      head: '<div class="fake-head">Голова</div>',
      side: '<div class="fake-side">Настройки</div>',
      bottom: '<div class="fake-timeline">Кадры</div>',
    },
    attachTo: document.body,
  })
  await wrapper.setProps({ fullscreen: true })
  return wrapper
}

const fullscreenOverlay = (): HTMLElement | null => document.body.querySelector('.popup-shell__overlay')

const fullscreenPanel = (): HTMLElement | null => document.body.querySelector('.viewer-3d-fullscreen__content')

const isOverlayHidden = (): boolean => fullscreenOverlay()?.style.display === 'none'

const openFullscreen = async (wrapper: VueWrapper): Promise<void> => {
  const baseToolbar = wrapper
    .findAllComponents({ name: 'ViewerToolbar' })
    .find((toolbar) => (toolbar.element as HTMLElement).closest('.viewer-3d') !== null)
  baseToolbar?.vm.$emit('toggle-fullscreen')
  await wrapper.vm.$nextTick()
}

describe('Viewer3D', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('keeps the fullscreen overlay hidden and inert initially', () => {
    mountViewer()

    expect(fullscreenOverlay()).not.toBeNull()
    expect(isOverlayHidden()).toBe(true)
    expect(document.body.querySelector('.viewer-3d-fullscreen__head')).toBeNull()
    expect(document.body.querySelector('.viewer-3d-fullscreen__side')).toBeNull()
  })

  it('renders the fullscreen overlay as a modal dialog with an accessible name', async () => {
    const wrapper = mountViewer()
    await openFullscreen(wrapper)

    const dialog = fullscreenPanel()
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Просмотр 3D-модели')
    expect(fullscreenOverlay()?.classList.contains('viewer-3d-fullscreen__overlay')).toBe(true)
    expect(isOverlayHidden()).toBe(false)

    wrapper.unmount()
  })

  it('closes the fullscreen overlay on Escape', async () => {
    const wrapper = mountViewer()
    await openFullscreen(wrapper)
    expect(isOverlayHidden()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(isOverlayHidden()).toBe(true)
    wrapper.unmount()
  })

  it('pulls the focus into the fullscreen overlay on Tab', async () => {
    const wrapper = mountViewer()
    await openFullscreen(wrapper)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    const overlay = fullscreenOverlay()
    expect(overlay).not.toBeNull()
    expect(overlay?.contains(document.activeElement)).toBe(true)

    wrapper.unmount()
  })

  it('emits the fullscreen model update when the viewer asks to expand', async () => {
    const wrapper = mountViewer({ fullscreen: false })
    await wrapper.setProps({ 'onUpdate:fullscreen': vi.fn() })
    await openFullscreen(wrapper)

    expect(wrapper.emitted('update:fullscreen')).toEqual([[true]])
    expect(isOverlayHidden()).toBe(true)

    wrapper.unmount()
  })

  it('renders the head and side panels in workspace mode', async () => {
    const wrapper = await mountWorkspace()

    expect(document.body.querySelector('.viewer-3d-fullscreen__head')).not.toBeNull()
    expect(document.body.querySelector('.viewer-3d-fullscreen__side')).not.toBeNull()
    expect(document.body.querySelector('.viewer-3d-fullscreen__content--workspace')).not.toBeNull()

    wrapper.unmount()
  })

  it('lays out the scene, the settings column and the frame panel in workspace mode', async () => {
    const wrapper = await mountWorkspace()

    const head = document.body.querySelector('.viewer-3d-fullscreen__head')
    const side = document.body.querySelector('.viewer-3d-fullscreen__side')
    const bottom = document.body.querySelector('.viewer-3d-fullscreen__bottom')
    const stage = document.body.querySelector('.viewer-3d-fullscreen__scene .viewer-3d-fullscreen__stage')

    expect(head?.textContent).toContain('Голова')
    expect(side?.textContent).toContain('Настройки')
    expect(bottom?.textContent).toContain('Кадры')
    expect(stage?.querySelector('.fake-canvas')).not.toBeNull()

    wrapper.unmount()
  })
})

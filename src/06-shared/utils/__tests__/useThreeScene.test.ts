import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ref, type Ref } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useThreeScene } from '../useThreeScene'

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement = document.createElement('canvas')
    setSize = vi.fn()
    setPixelRatio = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    forceContextLoss = vi.fn()
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

vi.mock('three/addons/controls/OrbitControls.js', () => ({
  OrbitControls: class FakeOrbitControls {
    enableDamping = false
    dampingFactor = 0
    enableZoom = false
    enablePan = false
    minPolarAngle = 0
    maxPolarAngle = Math.PI
    autoRotate = false
    autoRotateSpeed = 0
    update(): void {}
    dispose(): void {}
  },
}))

describe('useThreeScene', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn((): number => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState')
    vi.unstubAllGlobals()
  })

  const makeContainer = (width: number, height: number): Ref<HTMLDivElement | null> => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
    return ref<HTMLDivElement | null>(el)
  }

  const setVisibilityState = (state: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  }

  it('falls back to a finite camera aspect when the container is hidden', () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container))

    expect(result.camera.value).not.toBeNull()
    expect(result.camera.value?.aspect).toBe(1)

    unmount()
    expect(result.camera.value).toBeNull()
  })

  it('accepts a numeric scene background', () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container, { background: 0x112233 }))

    const background = result.scene.value?.background
    expect(background).toBeInstanceOf(THREE.Color)
    expect((background as THREE.Color).getHex()).toBe(0x112233)

    unmount()
  })

  it('accepts a CSS color string as the scene background', () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container, { background: '#ff8800' }))

    const background = result.scene.value?.background
    expect(background).toBeInstanceOf(THREE.Color)
    expect((background as THREE.Color).getHex()).toBe(0xff8800)

    unmount()
  })

  it('re-resolves the CSS background when the data-theme attribute changes', async () => {
    const computedStyle = {
      getPropertyValue: (prop: string): string => (prop === '--viewer-bg' ? '#111111' : ''),
    }
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (() => computedStyle) as unknown as typeof window.getComputedStyle,
    )
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container))

    await Promise.resolve()
    expect((result.scene.value?.background as THREE.Color | null)?.getHex()).toBe(0x111111)

    computedStyle.getPropertyValue = (prop: string): string => (prop === '--viewer-bg' ? '#222222' : '')
    document.documentElement.setAttribute('data-theme', 'lime-light')
    await vi.waitFor(() => {
      expect((result.scene.value?.background as THREE.Color | null)?.getHex()).toBe(0x222222)
    })

    document.documentElement.removeAttribute('data-theme')
    unmount()
  })

  it('keeps the explicit background option across theme changes', async () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container, { background: '#ff8800' }))

    document.documentElement.setAttribute('data-theme', 'lime-light')
    await vi.waitFor(() => {
      expect((result.scene.value?.background as THREE.Color | null)?.getHex()).toBe(0xff8800)
    })

    document.documentElement.removeAttribute('data-theme')
    unmount()
  })

  it('cancels the pending animation frame handle on unmount', () => {
    const cancelFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn((): number => 42))
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const container = makeContainer(300, 300)
    const { unmount } = withSetup(() => useThreeScene(container))

    unmount()

    expect(cancelFrame).toHaveBeenCalledWith(42)
  })

  it('does not schedule frames while the container has zero size', () => {
    const raf = vi.fn((): number => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    const container = makeContainer(0, 0)
    const { unmount } = withSetup(() => useThreeScene(container))

    expect(raf).not.toHaveBeenCalled()

    unmount()
  })

  it('schedules a frame for a visible container', () => {
    const raf = vi.fn((): number => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    const container = makeContainer(300, 300)
    const { unmount } = withSetup(() => useThreeScene(container))

    expect(raf).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('resumes scheduling when the container regains its size', () => {
    const raf = vi.fn((): number => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    const container = makeContainer(0, 0)
    const { unmount } = withSetup(() => useThreeScene(container))
    expect(raf).not.toHaveBeenCalled()

    const el = container.value as HTMLDivElement
    Object.defineProperty(el, 'clientWidth', { value: 300 })
    Object.defineProperty(el, 'clientHeight', { value: 300 })
    window.dispatchEvent(new Event('resize'))

    expect(raf).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('pauses scheduling while the document is hidden and resumes on visibility', () => {
    const raf = vi.fn((): number => 1)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const container = makeContainer(300, 300)
    const { unmount } = withSetup(() => useThreeScene(container))
    expect(raf).toHaveBeenCalledTimes(1)

    setVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalledWith(1)
    expect(raf).toHaveBeenCalledTimes(1)

    setVisibilityState('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(raf).toHaveBeenCalledTimes(2)

    unmount()
  })

  it('keeps the loop paused when the document stays hidden across a resize', () => {
    const raf = vi.fn((): number => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    const container = makeContainer(0, 0)
    const { unmount } = withSetup(() => useThreeScene(container))
    setVisibilityState('hidden')

    const el = container.value as HTMLDivElement
    Object.defineProperty(el, 'clientWidth', { value: 300 })
    Object.defineProperty(el, 'clientHeight', { value: 300 })
    window.dispatchEvent(new Event('resize'))
    expect(raf).not.toHaveBeenCalled()

    unmount()
  })

  it('releases the WebGL context before disposing the renderer', () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const { result, unmount } = withSetup(() => useThreeScene(container))
    const renderer = result.renderer.value as unknown as { dispose: Mock; forceContextLoss: Mock }
    const teardown: string[] = []
    renderer.forceContextLoss.mockImplementation((): void => {
      teardown.push('context-loss')
    })
    renderer.dispose.mockImplementation((): void => {
      teardown.push('dispose')
    })

    unmount()

    expect(teardown).toEqual(['context-loss', 'dispose'])
  })
})

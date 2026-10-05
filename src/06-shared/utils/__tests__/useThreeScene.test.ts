import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
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
    vi.unstubAllGlobals()
  })

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
})

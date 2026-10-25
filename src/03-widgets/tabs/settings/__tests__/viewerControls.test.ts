import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { provideViewerControls, useViewerControls } from '../viewerControls'
import type { ViewerControls } from '@/06-shared'

const mountWithYaw = (defaultYaw: number): ViewerControls => {
  let captured: ViewerControls | null = null
  const child = defineComponent({
    setup(): void {
      captured = useViewerControls()
    },
    render: () => h('div'),
  })
  const host = defineComponent({
    setup(): void {
      provideViewerControls(() => 5, defaultYaw)
    },
    render: () => h(child),
  })
  mount(host)
  if (captured === null) throw new Error('controls were not provided')
  return captured
}

describe('viewerControls default yaw', () => {
  it('defaults the skin viewer yaw to zero', () => {
    const controls = mountWithYaw(0)

    expect(controls.rotationY.value).toBe(0)
    controls.resetView()
    expect(controls.rotationY.value).toBe(0)
  })

  it('starts the cpm viewer with the model facing the camera', () => {
    const controls = mountWithYaw(180)

    expect(controls.rotationY.value).toBe(180)
  })

  it('returns the yaw to the default on reset view', () => {
    const controls = mountWithYaw(180)

    controls.rotateRight()
    expect(controls.rotationY.value).toBe(225)

    controls.resetView()
    expect(controls.rotationY.value).toBe(180)
  })
})

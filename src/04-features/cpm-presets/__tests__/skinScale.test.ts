import { describe, expect, it } from 'vitest'
import type { CPMConfig } from '@/05-entities'
import { scaleSkinLayout } from '../skinScale'

const PRESET_CONFIG: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'body',
      name: 'body',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [
        {
          name: 'torso',
          size: { x: 8, y: 12, z: 4 },
          offset: { x: -4, y: 0, z: -2 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          u: 16,
          v: 16,
          textureSize: 1,
        },
        {
          name: 'dense-cube',
          size: { x: 2, y: 2, z: 2 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          u: 40,
          v: 0,
          textureSize: 3,
          mirror: true,
          children: [
            {
              name: 'nested-faceuv',
              size: { x: 1, y: 1, z: 1 },
              offset: { x: 0, y: 0, z: 0 },
              pos: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              faceUV: {
                north: { sx: 1, sy: 2, ex: 3, ey: 4, rot: '90', autoUV: false },
                up: { sx: 5.5, sy: 0, ex: 6.5, ey: 1, rot: '0', autoUV: true },
              },
            },
          ],
        },
        {
          name: 'colored-cube',
          size: { x: 1, y: 1, z: 1 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          texture: false,
          color: '#ff0000',
        },
        {
          name: 'implicit-texture-size',
          size: { x: 4, y: 4, z: 4 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          u: 32,
          v: 32,
        },
      ],
    },
  ],
}

function childOf(config: CPMConfig, name: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const visit = (children: unknown[]): void => {
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        found.push(child as Record<string, unknown>)
        const nested = (child as Record<string, unknown>).children
        if (Array.isArray(nested)) visit(nested)
      }
    }
  }
  visit(config.elements)
  return found.filter((child) => child.name === name)
}

describe('scaleSkinLayout', () => {
  it('scales the layout for S=1 without changing UV semantics', () => {
    const result = scaleSkinLayout(PRESET_CONFIG, 1)

    expect(result.skinSize).toEqual({ x: 64, y: 64 })
    const torso = childOf(result, 'torso')[0] as Record<string, unknown>
    expect(torso.u).toBe(16)
    expect(torso.v).toBe(16)
    expect(torso.textureSize).toBe(1)
  })

  it('scales textureSize, faceUV and skinSize for S=8 while keeping u/v', () => {
    const result = scaleSkinLayout(PRESET_CONFIG, 8)

    expect(result.skinSize).toEqual({ x: 512, y: 512 })

    const torso = childOf(result, 'torso')[0] as Record<string, unknown>
    expect(torso.textureSize).toBe(8)
    expect(torso.u).toBe(16)
    expect(torso.v).toBe(16)

    const dense = childOf(result, 'dense-cube')[0] as Record<string, unknown>
    expect(dense.textureSize).toBe(24)
    expect(dense.mirror).toBe(true)

    const nested = childOf(result, 'nested-faceuv')[0] as { faceUV: Record<string, Record<string, unknown>> }
    expect(nested.faceUV.north).toEqual({ sx: 8, sy: 16, ex: 24, ey: 32, rot: '90', autoUV: false })
    expect(nested.faceUV.up).toEqual({ sx: 44, sy: 0, ex: 52, ey: 8, rot: '0', autoUV: true })
  })

  it('leaves colored cubes untouched', () => {
    const result = scaleSkinLayout(PRESET_CONFIG, 8)

    const colored = childOf(result, 'colored-cube')[0] as Record<string, unknown>
    expect(colored.texture).toBe(false)
    expect(colored.textureSize).toBeUndefined()
    expect(colored.color).toBe('#ff0000')
  })

  it('materializes the implicit textureSize default', () => {
    const result = scaleSkinLayout(PRESET_CONFIG, 2)

    const implicit = childOf(result, 'implicit-texture-size')[0] as Record<string, unknown>
    expect(implicit.textureSize).toBe(2)
    expect(implicit.u).toBe(32)
  })

  it('keeps mirror textureSize within the signed byte range for S=8', () => {
    const config: CPMConfig = {
      skinSize: { x: 64, y: 64 },
      elements: [
        {
          id: 'body',
          name: 'body',
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          children: [
            {
              name: 'edge-mirror',
              size: { x: 1, y: 1, z: 1 },
              offset: { x: 0, y: 0, z: 0 },
              pos: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              u: 0,
              v: 0,
              textureSize: 16,
              mirror: true,
            },
          ],
        },
      ],
    }

    const result = scaleSkinLayout(config, 8)

    const edge = childOf(result, 'edge-mirror')[0] as Record<string, unknown>
    expect(edge.textureSize).toBe(128)
    expect(edge.mirror).toBe(true)
  })

  it('scales synthetic S=16 and S=32 layouts without real PNGs', () => {
    const s16 = scaleSkinLayout(PRESET_CONFIG, 16)
    expect(s16.skinSize).toEqual({ x: 1024, y: 1024 })
    expect((childOf(s16, 'dense-cube')[0] as Record<string, unknown>).textureSize).toBe(48)

    const s32 = scaleSkinLayout(PRESET_CONFIG, 32)
    expect(s32.skinSize).toEqual({ x: 2048, y: 2048 })
    expect((childOf(s32, 'dense-cube')[0] as Record<string, unknown>).textureSize).toBe(96)
    const nested = childOf(s32, 'nested-faceuv')[0] as { faceUV: Record<string, Record<string, number>> }
    expect(nested.faceUV.north).toMatchObject({ sx: 32, sy: 64, ex: 96, ey: 128 })
  })

  it('does not mutate the input config', () => {
    const before = JSON.stringify(PRESET_CONFIG)

    scaleSkinLayout(PRESET_CONFIG, 8)

    expect(JSON.stringify(PRESET_CONFIG)).toBe(before)
  })

  it('rejects a non-integer or non-positive scale', () => {
    expect(() => scaleSkinLayout(PRESET_CONFIG, 0)).toThrow('целым')
    expect(() => scaleSkinLayout(PRESET_CONFIG, -2)).toThrow('целым')
    expect(() => scaleSkinLayout(PRESET_CONFIG, 1.5)).toThrow('целым')
  })
})

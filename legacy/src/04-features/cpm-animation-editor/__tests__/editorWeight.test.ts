import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CPMAnimation, CPMConfig } from '@/05-entities'
import { cpmProjectToBytes } from '../../cpm-convert/cpmProjectExporter'
import {
  CPM_PROJECT_SAVE_MAX_BYTES,
  evaluateCpmProjectWeight,
  measureCpmProjectWeight,
} from '../editorWeight'

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Head',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  ],
}

const skinPng = new Uint8Array(24)
skinPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
skinPng[19] = 64
skinPng[23] = 64

const animation: CPMAnimation = {
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  layerControlled: false,
  frames: [
    {
      components: [{
        storeID: 0,
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 30, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
        color: '0',
      }],
    },
  ],
}

async function buildProject(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('config.json', JSON.stringify(config))
  zip.file('skin.png', skinPng)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('evaluateCpmProjectWeight', () => {
  it('warns only when the result is over the limit', () => {
    const atLimit = evaluateCpmProjectWeight(CPM_PROJECT_SAVE_MAX_BYTES)
    expect(atLimit.exceedsLimit).toBe(false)
    expect(atLimit.warning).toBeNull()

    const overLimit = evaluateCpmProjectWeight(CPM_PROJECT_SAVE_MAX_BYTES + 1)
    expect(overLimit.exceedsLimit).toBe(true)
    expect(overLimit.warning).toContain('превышает')
    expect(overLimit.bytes).toBe(CPM_PROJECT_SAVE_MAX_BYTES + 1)
  })

  it('supports a custom limit', () => {
    const weight = evaluateCpmProjectWeight(2048, 1024)

    expect(weight.limitBytes).toBe(1024)
    expect(weight.exceedsLimit).toBe(true)
    expect(weight.warning).toContain('МБ')
  })
})

describe('measureCpmProjectWeight', () => {
  it('uses the length of the existing save path result', async () => {
    const project = await buildProject()
    const source = { animations: [animation], animEnc: null }

    const weight = await measureCpmProjectWeight(project, source)
    const expected = await cpmProjectToBytes(project, source)

    expect(weight.bytes).toBe(expected.byteLength)
    expect(weight.limitBytes).toBe(CPM_PROJECT_SAVE_MAX_BYTES)
    expect(weight.exceedsLimit).toBe(false)
  })

  it('grows when animations are added', async () => {
    const project = await buildProject()
    const empty = await measureCpmProjectWeight(project, { animations: [], animEnc: null })
    const withAnimation = await measureCpmProjectWeight(project, { animations: [animation], animEnc: null })

    expect(withAnimation.bytes).toBeGreaterThan(empty.bytes)
  })
})

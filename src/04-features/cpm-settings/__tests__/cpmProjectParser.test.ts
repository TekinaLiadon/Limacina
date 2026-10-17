import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { parseCpmProjectFile, readCpmProjectZip } from '../cpmProjectParser'
import type { CPMConfig } from '@/05-entities'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'head',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  ],
}

const skinBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const fakeSkinBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x10, 0x00, 0x57, 0x45, 0x42, 0x50,
])

async function buildZip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

describe('readCpmProjectZip', () => {
  it('reads config and skin bytes from the archive', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
    })

    const project = await readCpmProjectZip(data)

    expect(project.config).toEqual(config)
    expect(project.skinPng).toEqual(skinBytes)
  })

  it('returns null skin when skin.png is absent', async () => {
    const data = await buildZip({ 'config.json': JSON.stringify(config) })

    const project = await readCpmProjectZip(data)

    expect(project.skinPng).toBeNull()
  })

  it('throws when config.json is absent', async () => {
    const data = await buildZip({ 'skin.png': skinBytes })

    await expect(readCpmProjectZip(data)).rejects.toThrow('ZIP не содержит config.json')
  })

  it('throws a clear error for a broken config.json', async () => {
    const data = await buildZip({
      'config.json': '{ broken json',
      'skin.png': skinBytes,
    })

    await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
  })

  it('throws a clear error when config.json is missing skinSize', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify({ elements: [] }),
      'skin.png': skinBytes,
    })

    await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
  })

  it('throws a clear error when config.json is missing elements', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify({ skinSize: { x: 64, y: 64 } }),
      'skin.png': skinBytes,
    })

    await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
  })

  it('throws a clear error when config.json is not an object', async () => {
    for (const body of ['null', '"text"', '[1, 2]']) {
      const data = await buildZip({
        'config.json': body,
        'skin.png': skinBytes,
      })

      await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
    }
  })

  it('throws a clear error when skinSize is not an object of numbers', async () => {
    for (const skinSize of ['64x64', { x: '64', y: 64 }, { x: 64 }]) {
      const data = await buildZip({
        'config.json': JSON.stringify({ skinSize, elements: [] }),
        'skin.png': skinBytes,
      })

      await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
    }
  })

  it('throws a clear error when elements contain non-object entries', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify({ skinSize: { x: 64, y: 64 }, elements: [null, 5, 'head'] }),
      'skin.png': skinBytes,
    })

    await expect(readCpmProjectZip(data)).rejects.toThrow('Некорректный config.json в файле проекта')
  })

  it('throws when skin.png is a renamed non-png payload', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': fakeSkinBytes,
    })

    await expect(readCpmProjectZip(data)).rejects.toThrow(
      'skin.png в файле проекта не является PNG-изображением',
    )
  })

  it('rejects a zip bomb exceeding the uncompressed budget', async () => {
    const bomb = '0'.repeat(33 * 1024 * 1024)
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
      'animations/g_bomb.json': JSON.stringify({ name: 'Bomb', frames: bomb }),
    })

    await expect(parseCpmProjectFile(data)).rejects.toThrow(
      'Файл проекта слишком большой после распаковки',
    )
  })
})

describe('parseCpmProjectFile', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  it('builds a project with texture blob and animations', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
      'animations/g_pulse.json': JSON.stringify({ name: 'Pulse', duration: 700 }),
    })

    const project = await parseCpmProjectFile(data)

    expect(project.config).toEqual(config)
    expect(project.textureBlob.size).toBe(skinBytes.length)
    expect(project.animations).toHaveLength(1)
    expect(project.animations[0]?.name).toBe('Pulse')
  })

  it('throws when skin.png is absent', async () => {
    const data = await buildZip({ 'config.json': JSON.stringify(config) })

    await expect(parseCpmProjectFile(data)).rejects.toThrow('Файл не содержит skin.png')
  })

  it('reads the animation encoding next to the animations', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
      'animations/g_pulse.json': JSON.stringify({ name: 'Pulse' }),
      'anim_enc.json': JSON.stringify({ freeLayers: ['hat', 'jacket'], defaultValues: { hat: true } }),
    })

    const project = await parseCpmProjectFile(data)

    expect(project.animEnc).toEqual({
      freeLayers: ['hat', 'jacket'],
      defaultValues: { hat: true },
    })
  })

  it('returns no animation encoding for a project without the file', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
    })

    expect((await parseCpmProjectFile(data)).animEnc).toBeNull()
  })

  it('reports broken animation files and keeps the valid ones', async () => {
    const data = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
      'animations/good.json': JSON.stringify({ name: 'Good' }),
      'animations/bad.json': '{ broken',
    })

    const project = await parseCpmProjectFile(data)

    expect(project.animations).toHaveLength(1)
    expect(project.animations[0]?.name).toBe('Good')
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('bad.json'))
  })
})

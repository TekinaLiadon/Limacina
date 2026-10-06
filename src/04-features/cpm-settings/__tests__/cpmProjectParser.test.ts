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

const skinBytes = new Uint8Array([1, 2, 3, 4])

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

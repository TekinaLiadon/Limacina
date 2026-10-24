import { afterEach, describe, expect, it, vi } from 'vitest'
import { crc32 } from 'node:zlib'
import { decodePngSkin, encodePngSkin, type SkinImage } from '../skinPng'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(out.length - 4, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function ihdr(width: number, height: number, colorType: number, bitDepth: number = 8, interlace: number = 0): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = bitDepth
  data[9] = colorType
  data[12] = interlace
  return pngChunk('IHDR', data)
}

async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(bytes)
      controller.close()
    },
  }).pipeThrough(new CompressionStream('deflate'))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parts.push(value)
  }
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

async function buildPng(chunks: Uint8Array[]): Promise<Uint8Array> {
  const parts = [new Uint8Array(PNG_SIGNATURE), ...chunks, pngChunk('IEND', new Uint8Array())]
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

function applyFilter(filter: number, raw: Uint8Array, previous: Uint8Array | null, bpp: number): Uint8Array {
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i] ?? 0
    const left = i >= bpp ? raw[i - bpp] ?? 0 : 0
    const up = previous ? previous[i] ?? 0 : 0
    const upLeft = previous && i >= bpp ? previous[i - bpp] ?? 0 : 0
    if (filter === 0) out[i] = value
    else if (filter === 1) out[i] = (value - left) & 0xFF
    else if (filter === 2) out[i] = (value - up) & 0xFF
    else if (filter === 3) out[i] = (value - ((left + up) >> 1)) & 0xFF
    else out[i] = (value - paeth(left, up, upLeft)) & 0xFF
  }
  return out
}

async function scanlinesToIdat(rows: Array<{ filter: number, bytes: Uint8Array }>, bpp: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const decoded: Uint8Array[] = []
  for (const row of rows) {
    parts.push(new Uint8Array([row.filter]), applyFilter(row.filter, row.bytes, decoded[decoded.length - 1] ?? null, bpp))
    decoded.push(row.bytes)
  }
  let total = 0
  for (const part of parts) total += part.byteLength
  const raw = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    raw.set(part, offset)
    offset += part.byteLength
  }
  return zlibDeflate(raw)
}

function imageOf(width: number, height: number, pixels: number[][]): SkinImage {
  const rgba = new Uint8Array(width * height * 4)
  pixels.forEach((pixel, index) => {
    rgba.set(pixel, index * 4)
  })
  return { width, height, rgba }
}

describe('encodePngSkin + decodePngSkin', () => {
  it('round-trips an RGBA image', async () => {
    const image = imageOf(2, 3, [
      [1, 2, 3, 4], [250, 251, 252, 253],
      [10, 20, 30, 0], [200, 100, 50, 128],
      [255, 0, 255, 255], [0, 255, 0, 1],
    ])

    const decoded = await decodePngSkin(await encodePngSkin(image))

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(3)
    expect(Array.from(decoded.rgba)).toEqual(Array.from(image.rgba))
  })
})

describe('decodePngSkin', () => {
  it('decodes scanlines with Sub and Up filters', async () => {
    const rows = [
      { filter: 1, bytes: new Uint8Array([10, 20, 30, 255, 60, 70, 80, 255]) },
      { filter: 2, bytes: new Uint8Array([5, 6, 7, 8, 200, 210, 220, 230]) },
    ]
    const png = await buildPng([ihdr(2, 2, 6), pngChunk('IDAT', await scanlinesToIdat(rows, 4))])

    const decoded = await decodePngSkin(png)

    expect(Array.from(decoded.rgba)).toEqual([...rows[0]!.bytes, ...rows[1]!.bytes])
  })

  it('decodes scanlines with Average and Paeth filters', async () => {
    const rows = [
      { filter: 3, bytes: new Uint8Array([100, 110, 120, 130, 140, 150, 160, 170]) },
      { filter: 4, bytes: new Uint8Array([1, 250, 60, 70, 128, 129, 130, 0]) },
    ]
    const png = await buildPng([ihdr(2, 2, 6), pngChunk('IDAT', await scanlinesToIdat(rows, 4))])

    const decoded = await decodePngSkin(png)

    expect(Array.from(decoded.rgba)).toEqual([...rows[0]!.bytes, ...rows[1]!.bytes])
  })

  it('decodes an opaque truecolor image', async () => {
    const rows = [{ filter: 0, bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) }]
    const png = await buildPng([ihdr(2, 1, 2), pngChunk('IDAT', await scanlinesToIdat(rows, 3))])

    const decoded = await decodePngSkin(png)

    expect(Array.from(decoded.rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
  })

  it('decodes a grayscale image', async () => {
    const rows = [{ filter: 0, bytes: new Uint8Array([77, 200]) }]
    const png = await buildPng([ihdr(2, 1, 0), pngChunk('IDAT', await scanlinesToIdat(rows, 1))])

    const decoded = await decodePngSkin(png)

    expect(Array.from(decoded.rgba)).toEqual([77, 77, 77, 255, 200, 200, 200, 255])
  })

  it('decodes a palette image with tRNS alpha', async () => {
    const rows = [{ filter: 0, bytes: new Uint8Array([0, 1, 1, 0]) }]
    const png = await buildPng([
      ihdr(4, 1, 3),
      pngChunk('PLTE', new Uint8Array([255, 0, 0, 0, 0, 255])),
      pngChunk('tRNS', new Uint8Array([255, 128])),
      pngChunk('IDAT', await scanlinesToIdat(rows, 1)),
    ])

    const decoded = await decodePngSkin(png)

    expect(Array.from(decoded.rgba)).toEqual([
      255, 0, 0, 255,
      0, 0, 255, 128,
      0, 0, 255, 128,
      255, 0, 0, 255,
    ])
  })

  it('rejects a non-PNG file', async () => {
    await expect(decodePngSkin(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('PNG')
  })

  it('rejects an interlaced image', async () => {
    const png = await buildPng([ihdr(1, 1, 6, 8, 1)])
    await expect(decodePngSkin(png)).rejects.toThrow('Чересстрочный')
  })

  it('rejects a 16-bit image', async () => {
    const png = await buildPng([ihdr(1, 1, 6, 16)])
    await expect(decodePngSkin(png)).rejects.toThrow('Битность')
  })

  it('rejects corrupted pixel data', async () => {
    const broken = await zlibDeflate(new Uint8Array([0, 1, 2, 3]))
    const png = await buildPng([ihdr(64, 64, 6), pngChunk('IDAT', broken.subarray(0, broken.byteLength - 8))])
    await expect(decodePngSkin(png)).rejects.toThrow('повреждён')
  })

  it('rejects a pixel bomb before inflating', async () => {
    const png = await buildPng([ihdr(8128, 8128, 6), pngChunk('IDAT', new Uint8Array([1, 2, 3]))])
    await expect(decodePngSkin(png)).rejects.toThrow('слишком большой')
  })
})

describe('decodePngSkin + encodePngSkin canvas fallback', () => {
  afterEach((): void => {
    vi.unstubAllGlobals()
  })

  it('decodes via canvas when compression streams are unavailable', async () => {
    const png = await encodePngSkin(imageOf(1, 1, [[10, 20, 30, 40]]))
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('no bitmap')
    }))

    await expect(decodePngSkin(png)).rejects.toThrow('повреждён')
  })

  it('rejects a pixel bomb before canvas decoding without compression streams', async () => {
    const png = await buildPng([ihdr(8128, 8128, 6), pngChunk('IDAT', new Uint8Array([1, 2, 3]))])
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    vi.stubGlobal('createImageBitmap', vi.fn())

    await expect(decodePngSkin(png)).rejects.toThrow('слишком большой')
  })

  it('encodes via canvas when compression streams are unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    const fakeCanvas = { width: 0, height: 0, getContext: (): null => null }
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement)

    try {
      await expect(encodePngSkin(imageOf(1, 1, [[1, 2, 3, 4]]))).rejects.toThrow('Не удалось закодировать PNG')
    } finally {
      createElement.mockRestore()
    }
  })
})

describe('encodePngSkin', () => {
  it('rejects an rgba buffer that does not match the dimensions', async () => {
    const image: SkinImage = { width: 2, height: 2, rgba: new Uint8Array(4) }
    await expect(encodePngSkin(image)).rejects.toThrow('Размер')
  })
})

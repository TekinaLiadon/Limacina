import { hasPngSignature } from '@/06-shared'
import { MAX_SKIN_PIXELS } from './presetTypes'

export interface SkinImage {
  width: number
  height: number
  rgba: Uint8Array
}

interface PngParsed {
  header: DataView
  idat: Uint8Array[]
  palette: Uint8Array | null
  transAlpha: Uint8Array | null
}

const NOT_PNG_MESSAGE = 'Файл не является PNG-изображением'
const BROKEN_PNG_MESSAGE = 'PNG-файл повреждён'
const ENCODE_ERROR_MESSAGE = 'Не удалось закодировать PNG'
const COLOR_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PNG_SIGNATURE_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let value = n
  for (let bit = 0; bit < 8; bit++) value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[n] = value
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    const tableIndex = (crc ^ (bytes[i] ?? 0)) & 0xFF
    crc = (CRC_TABLE[tableIndex] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

async function transformBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const reader = source.pipeThrough(transform as CompressionStream).getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parts.push(value)
  }
  return concatBytes(parts)
}

function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return transformBytes(bytes, new DecompressionStream('deflate'))
}

function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return transformBytes(bytes, new CompressionStream('deflate'))
}

const hasCompressionStreams = (): boolean =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

async function decodeViaCanvas(bytes: Uint8Array): Promise<SkinImage> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error(BROKEN_PNG_MESSAGE)
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(data.data) }
  } catch {
    throw new Error(BROKEN_PNG_MESSAGE)
  }
}

async function encodeViaCanvas(image: SkinImage): Promise<Uint8Array> {
  const { width, height, rgba } = image
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error(ENCODE_ERROR_MESSAGE)
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png')
  })
  if (blob === null) throw new Error(ENCODE_ERROR_MESSAGE)
  return new Uint8Array(await blob.arrayBuffer())
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
}

function parseChunks(bytes: Uint8Array): PngParsed {
  const parsed: PngParsed = { header: new DataView(new ArrayBuffer(13)), idat: [], palette: null, transAlpha: null }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let sawHeader = false
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.byteLength) throw new Error(BROKEN_PNG_MESSAGE)
    const type = chunkType(bytes, offset + 4)
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      if (length !== 13) throw new Error(BROKEN_PNG_MESSAGE)
      parsed.header = new DataView(data.buffer, data.byteOffset, data.byteLength)
      sawHeader = true
    } else if (type === 'IDAT') {
      parsed.idat.push(data)
    } else if (type === 'PLTE') {
      parsed.palette = data
    } else if (type === 'tRNS') {
      parsed.transAlpha = data
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
  if (!sawHeader) throw new Error(BROKEN_PNG_MESSAGE)
  return parsed
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
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

function paethPredictor(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

function reconstructor(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  return paethPredictor(left, up, upLeft)
}

function writeRgbaPixel(out: Uint8Array, outOffset: number, r: number, g: number, b: number, a: number): void {
  out[outOffset] = r
  out[outOffset + 1] = g
  out[outOffset + 2] = b
  out[outOffset + 3] = a
}

function convertScanline(
  out: Uint8Array,
  row: Uint8Array,
  y: number,
  width: number,
  colorType: number,
  channels: number,
  palette: Uint8Array | null,
  transAlpha: Uint8Array | null,
): void {
  const rowStart = y * width * 4
  for (let x = 0; x < width; x++) {
    const inOffset = x * channels
    const outOffset = rowStart + x * 4
    if (colorType === 6) {
      writeRgbaPixel(
        out,
        outOffset,
        row[inOffset] ?? 0,
        row[inOffset + 1] ?? 0,
        row[inOffset + 2] ?? 0,
        row[inOffset + 3] ?? 255,
      )
    } else if (colorType === 2) {
      writeRgbaPixel(out, outOffset, row[inOffset] ?? 0, row[inOffset + 1] ?? 0, row[inOffset + 2] ?? 0, 255)
    } else if (colorType === 0) {
      const gray = row[inOffset] ?? 0
      writeRgbaPixel(out, outOffset, gray, gray, gray, 255)
    } else if (colorType === 4) {
      const gray = row[inOffset] ?? 0
      writeRgbaPixel(out, outOffset, gray, gray, gray, row[inOffset + 1] ?? 255)
    } else {
      const index = row[inOffset] ?? 0
      const paletteOffset = index * 3
      if (palette === null || paletteOffset + 2 >= palette.length) throw new Error(BROKEN_PNG_MESSAGE)
      const alpha = transAlpha !== null && index < transAlpha.length ? transAlpha[index] ?? 255 : 255
      writeRgbaPixel(out, outOffset, palette[paletteOffset] ?? 0, palette[paletteOffset + 1] ?? 0, palette[paletteOffset + 2] ?? 0, alpha)
    }
  }
}

export async function decodePngSkin(bytes: Uint8Array): Promise<SkinImage> {
  if (!hasPngSignature(bytes)) throw new Error(NOT_PNG_MESSAGE)
  const { header, idat, palette, transAlpha } = parseChunks(bytes)

  const width = header.getUint32(0)
  const height = header.getUint32(4)
  const bitDepth = header.getUint8(8)
  const colorType = header.getUint8(9)
  const interlace = header.getUint8(12)
  if (bitDepth !== 8) throw new Error(`Битность PNG ${bitDepth} не поддерживается, ожидается 8`)
  if (interlace !== 0) throw new Error('Чересстрочный PNG не поддерживается')
  const channels = COLOR_CHANNELS[colorType]
  if (channels === undefined) throw new Error(`Цветовая модель PNG (тип ${colorType}) не поддерживается`)
  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error(BROKEN_PNG_MESSAGE)
  if (width * height > MAX_SKIN_PIXELS) {
    throw new Error(`Скин ${width}×${height} слишком большой: не более ${MAX_SKIN_PIXELS} пикселей`)
  }
  if (!hasCompressionStreams()) return decodeViaCanvas(bytes)

  let scanlines: Uint8Array
  try {
    scanlines = await inflate(concatBytes(idat))
  } catch {
    throw new Error(BROKEN_PNG_MESSAGE)
  }
  const stride = width * channels
  if (scanlines.length !== height * (stride + 1)) throw new Error(BROKEN_PNG_MESSAGE)

  const rgba = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  const row = new Uint8Array(stride)
  let cursor = 0
  for (let y = 0; y < height; y++) {
    const filter = scanlines[cursor] ?? 0
    cursor++
    if (filter > 4) throw new Error(BROKEN_PNG_MESSAGE)
    for (let i = 0; i < stride; i++) {
      const encoded = scanlines[cursor] ?? 0
      cursor++
      const left = i >= channels ? row[i - channels] ?? 0 : 0
      const up = y > 0 ? previous[i] ?? 0 : 0
      const upLeft = y > 0 && i >= channels ? previous[i - channels] ?? 0 : 0
      row[i] = (encoded + reconstructor(filter, left, up, upLeft)) & 0xFF
    }
    convertScanline(rgba, row, y, width, colorType, channels, palette, transAlpha)
    previous.set(row)
  }
  return { width, height, rgba }
}

function writeChunk(parts: Uint8Array[], type: string, data: Uint8Array): void {
  const chunk = new Uint8Array(data.byteLength + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength)
  chunk.set(new TextEncoder().encode(type), 4)
  chunk.set(data, 8)
  view.setUint32(chunk.byteLength - 4, crc32(chunk.subarray(4, 8 + data.byteLength)))
  parts.push(chunk)
}

export async function encodePngSkin(image: SkinImage): Promise<Uint8Array> {
  const { width, height, rgba } = image
  if (rgba.length !== width * height * 4) {
    throw new Error('Размер пиксельного буфера не соответствует размеру изображения')
  }
  if (!hasCompressionStreams()) return encodeViaCanvas(image)
  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const idat = await deflate(scanlines)

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6

  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE_BYTES)]
  writeChunk(parts, 'IHDR', ihdr)
  writeChunk(parts, 'IDAT', idat)
  writeChunk(parts, 'IEND', new Uint8Array())

  return concatBytes(parts)
}

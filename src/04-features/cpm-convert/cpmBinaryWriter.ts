export const HEADER = 0x53
export const DIV = Math.floor(32767 / 48)

const INITIAL_CAPACITY = 1024

export function wrapAngle360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export class CpmBinaryWriter {
  private buffer: Uint8Array = new Uint8Array(INITIAL_CAPACITY)
  private length: number = 0

  private reserve(extra: number): void {
    const needed = this.length + extra
    if (needed <= this.buffer.length) return
    let capacity = this.buffer.length
    while (capacity < needed) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.buffer.subarray(0, this.length))
    this.buffer = grown
  }

  writeByte(v: number): void {
    this.reserve(1)
    this.buffer[this.length] = v & 0xFF
    this.length += 1
  }

  writeShort(v: number): void {
    this.reserve(2)
    this.buffer[this.length] = (v >>> 8) & 0xFF
    this.buffer[this.length + 1] = v & 0xFF
    this.length += 2
  }

  writeBytes(data: number[] | Uint8Array): void {
    this.reserve(data.length)
    if (data instanceof Uint8Array) {
      this.buffer.set(data, this.length)
      this.length += data.length
      return
    }
    for (const byte of data) {
      this.buffer[this.length] = byte
      this.length += 1
    }
  }

  writeVarInt(v: number): void {
    let value = v >>> 0
    while ((value & ~0x7F) !== 0) {
      this.writeByte((value & 0x7F) | 0x80)
      value >>>= 7
    }
    this.writeByte(value)
  }

  writeFloat2(f: number): void {
    const scaled = Math.round(f * DIV)
    if (!(scaled >= -32768 && scaled <= 32767)) {
      throw new Error(`Значение ${f} не помещается в формат вектора`)
    }
    this.writeShort(scaled)
  }

  writeVec6b(v: { x: number; y: number; z: number }): void {
    this.writeFloat2(v.x)
    this.writeFloat2(v.y)
    this.writeFloat2(v.z)
  }

  writeAngle(v: { x: number; y: number; z: number }): void {
    this.writeShort(this.angleShort(v.x))
    this.writeShort(this.angleShort(v.y))
    this.writeShort(this.angleShort(v.z))
  }

  private angleShort(v: number): number {
    const deg = wrapAngle360(v)
    return Math.max(0, Math.min(65535, Math.round(deg / 360 * 65535)))
  }

  writeEnum(ordinal: number): void {
    this.writeByte(ordinal)
  }

  writeUTF(value: string): void {
    let byteCount = 0
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code >= 0x0001 && code <= 0x007F) {
        byteCount += 1
      } else if (code === 0 || (code >= 0x0080 && code <= 0x07FF)) {
        byteCount += 2
      } else {
        byteCount += 3
      }
    }
    if (byteCount > 0xFFFF) throw new Error('Строка не помещается в формат UTF')
    this.writeShort(byteCount)
    this.reserve(byteCount)
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code >= 0x0001 && code <= 0x007F) {
        this.buffer[this.length] = code
        this.length += 1
      } else if (code === 0 || (code >= 0x0080 && code <= 0x07FF)) {
        this.buffer[this.length] = 0xC0 | ((code >> 6) & 0x1F)
        this.buffer[this.length + 1] = 0x80 | (code & 0x3F)
        this.length += 2
      } else {
        this.buffer[this.length] = 0xE0 | ((code >> 12) & 0x0F)
        this.buffer[this.length + 1] = 0x80 | ((code >> 6) & 0x3F)
        this.buffer[this.length + 2] = 0x80 | (code & 0x3F)
        this.length += 3
      }
    }
  }

  writeObjectBlock(ordinal: number, writeFn: (writer: CpmBinaryWriter) => void): void {
    this.writeEnum(ordinal)
    const inner = new CpmBinaryWriter()
    writeFn(inner)
    const data = inner.toArray()
    this.writeVarInt(data.length)
    this.writeBytes(data)
  }

  toArray(): Uint8Array {
    return this.buffer.slice(0, this.length)
  }
}

const BASE64_CHUNK_SIZE = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)))
  }
  return btoa(chunks.join(''))
}

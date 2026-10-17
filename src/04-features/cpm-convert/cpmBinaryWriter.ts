export const HEADER = 0x53
export const DIV = Math.floor(32767 / 48)

export class CpmBinaryWriter {
  private buffer: number[] = []

  writeByte(v: number): void {
    this.buffer.push(v & 0xFF)
  }

  writeShort(v: number): void {
    this.buffer.push((v >>> 8) & 0xFF)
    this.buffer.push(v & 0xFF)
  }

  writeBytes(data: number[] | Uint8Array): void {
    for (const byte of data) {
      this.buffer.push(byte)
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
    let deg = v
    while (deg < 0) deg += 360
    while (deg >= 360) deg -= 360
    return Math.max(0, Math.min(65535, Math.round(deg / 360 * 65535)))
  }

  writeEnum(ordinal: number): void {
    this.writeByte(ordinal)
  }

  writeUTF(value: string): void {
    const bytes: number[] = []
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code >= 0x0001 && code <= 0x007F) {
        bytes.push(code)
      } else if (code === 0 || (code >= 0x0080 && code <= 0x07FF)) {
        bytes.push(0xC0 | ((code >> 6) & 0x1F), 0x80 | (code & 0x3F))
      } else {
        bytes.push(0xE0 | ((code >> 12) & 0x0F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
      }
    }
    if (bytes.length > 0xFFFF) throw new Error('Строка не помещается в формат UTF')
    this.writeShort(bytes.length)
    this.writeBytes(bytes)
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
    return new Uint8Array(this.buffer)
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

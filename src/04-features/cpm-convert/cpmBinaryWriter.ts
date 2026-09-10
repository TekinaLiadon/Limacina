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
    for (let i = 0; i < data.length; i++) {
      this.buffer.push(data[i])
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

  writeSignedVarInt(v: number): void {
    const sign = v < 0 ? 0x40 : 0
    let value = Math.abs(v)
    let b = (value & 0x3F) | sign
    value >>>= 6
    while (value !== 0) {
      this.writeByte(b | 0x80)
      b = value & 0x7F
      value >>>= 7
    }
    this.writeByte(b)
  }

  writeVarFloat(f: number): void {
    this.writeSignedVarInt(Math.round(f * DIV))
  }

  writeFloat2(f: number): void {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(f * DIV)))
    this.writeShort(clamped)
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

  writeVarVec3(v: { x: number; y: number; z: number }): void {
    this.writeVarFloat(v.x)
    this.writeVarFloat(v.y)
    this.writeVarFloat(v.z)
  }

  writeEnum(ordinal: number): void {
    this.writeByte(ordinal)
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

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

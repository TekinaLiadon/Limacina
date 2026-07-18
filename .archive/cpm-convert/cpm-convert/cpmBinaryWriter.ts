export const HEADER = 0x53

export class CpmBinaryWriter {
  private buffer: number[] = []

  writeByte(v: number): void {
    this.buffer.push(v & 0xFF)
  }

  writeShort(v: number): void {
    this.buffer.push((v >>> 8) & 0xFF)
    this.buffer.push((v >>> 0) & 0xFF)
  }

  writeBytes(data: number[] | Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.buffer.push(data[i])
    }
  }

  writeVarInt(v: number): void {
    v = v >>> 0
    while ((v & ~0x7F) !== 0) {
      this.writeByte((v & 0x7F) | 0x80)
      v >>>= 7
    }
    this.writeByte(v)
  }

  writeSignedVarInt(v: number): void {
    const sign = v < 0 ? 0x40 : 0
    v = Math.abs(v)
    let b = (v & 0x3F) | sign
    v >>>= 6
    while (v !== 0) {
      this.writeByte(b | 0x80)
      b = v & 0x7F
      v >>>= 7
    }
    this.writeByte(b)
  }

  writeVarFloat(f: number): void {
    const DIV = 32767 / 2000
    this.writeSignedVarInt(Math.round(f * DIV))
  }

  writeFloat2(f: number): void {
    const DIV = 32767 / 2000
    const clamped = Math.max(-32768, Math.min(32767, Math.round(f * DIV)))
    this.writeShort(clamped)
  }

  writeVec3ub(v: { x: number; y: number; z: number }): void {
    const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val * 10)))
    this.writeByte(clamp(v.x))
    this.writeByte(clamp(v.y))
    this.writeByte(clamp(v.z))
  }

  writeVec6b(v: { x: number; y: number; z: number }): void {
    const DIV = 32767 / 2000
    this.writeShort(Math.max(-32768, Math.min(32767, Math.round(v.x * DIV))))
    this.writeShort(Math.max(-32768, Math.min(32767, Math.round(v.y * DIV))))
    this.writeShort(Math.max(-32768, Math.min(32767, Math.round(v.z * DIV))))
  }

  writeAngle(v: { x: number; y: number; z: number }): void {
    this.writeShort(Math.max(0, Math.min(65535, Math.round(v.x / 360 * 65535))))
    this.writeShort(Math.max(0, Math.min(65535, Math.round(v.y / 360 * 65535))))
    this.writeShort(Math.max(0, Math.min(65535, Math.round(v.z / 360 * 65535))))
  }

  writeVarVec3(v: { x: number; y: number; z: number }): void {
    this.writeVarFloat(v.x)
    this.writeVarFloat(v.y)
    this.writeVarFloat(v.z)
  }

  writeEnum(ordinal: number): void {
    this.writeByte(ordinal)
  }

  writeUtf(s: string): void {
    const bytes = new TextEncoder().encode(s)
    this.writeVarInt(bytes.length)
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

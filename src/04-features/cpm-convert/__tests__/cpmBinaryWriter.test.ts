import { describe, expect, it } from 'vitest'
import { CpmBinaryWriter, DIV, HEADER, bytesToBase64 } from '../cpmBinaryWriter'

const write = (fn: (w: CpmBinaryWriter) => void): number[] => {
  const w = new CpmBinaryWriter()
  fn(w)
  return [...w.toArray()]
}

describe('cpmBinaryWriter', () => {
  it('keeps the format constants from the mod sources', () => {
    expect(HEADER).toBe(0x53)
    expect(DIV).toBe(682)
  })

  it('masks writeByte to a single byte', () => {
    expect(write((w) => w.writeByte(0x53))).toEqual([83])
    expect(write((w) => w.writeByte(256))).toEqual([0])
  })

  it('writes shorts big-endian like DataOutputStream', () => {
    expect(write((w) => w.writeShort(0x1234))).toEqual([18, 52])
    expect(write((w) => w.writeShort(0x53))).toEqual([0, 83])
    expect(write((w) => w.writeShort(-682))).toEqual([253, 86])
  })

  it('copies writeBytes input as is', () => {
    expect(write((w) => w.writeBytes([1, 2, 3]))).toEqual([1, 2, 3])
    expect(write((w) => w.writeBytes(new Uint8Array([4, 5])))).toEqual([4, 5])
  })

  it('writes unsigned LEB128 varints like IOHelper.writeVarInt', () => {
    expect(write((w) => w.writeVarInt(0))).toEqual([0])
    expect(write((w) => w.writeVarInt(127))).toEqual([127])
    expect(write((w) => w.writeVarInt(128))).toEqual([128, 1])
    expect(write((w) => w.writeVarInt(300))).toEqual([172, 2])
    expect(write((w) => w.writeVarInt(16384))).toEqual([128, 128, 1])
    expect(write((w) => w.writeVarInt(2147483647))).toEqual([255, 255, 255, 255, 7])
  })

  it('scales floats by DIV with rounding', () => {
    expect(write((w) => w.writeFloat2(0))).toEqual([0, 0])
    expect(write((w) => w.writeFloat2(1))).toEqual([2, 170])
    expect(write((w) => w.writeFloat2(-1))).toEqual([253, 86])
    expect(write((w) => w.writeFloat2(0.25))).toEqual([0, 171])
    expect(write((w) => w.writeFloat2(48))).toEqual([127, 224])
  })

  it('rejects floats outside the short vector range', () => {
    expect(() => write((w) => w.writeFloat2(48.05))).toThrow(/не помещается/)
    expect(() => write((w) => w.writeFloat2(-48.1))).toThrow(/не помещается/)
  })

  it('writes vec6b as three scaled shorts', () => {
    expect(write((w) => w.writeVec6b({ x: 1, y: 0, z: -1 }))).toEqual([2, 170, 0, 0, 253, 86])
  })

  it('normalizes angles into 0-360 and scales them to shorts', () => {
    expect(write((w) => w.writeAngle({ x: 0, y: 0, z: 0 }))).toEqual([0, 0, 0, 0, 0, 0])
    expect(write((w) => w.writeAngle({ x: 90, y: 0, z: 0 }))).toEqual([64, 0, 0, 0, 0, 0])
    expect(write((w) => w.writeAngle({ x: -90, y: 450, z: 360 }))).toEqual([191, 255, 64, 0, 0, 0])
    expect(write((w) => w.writeAngle({ x: 7.5, y: 0, z: 0 }))).toEqual([5, 85, 0, 0, 0, 0])
  })

  it('writes object blocks as enum, varint length and payload', () => {
    expect(
      write((w) => w.writeObjectBlock(12, () => {})),
    ).toEqual([12, 0])
    expect(
      write((w) =>
        w.writeObjectBlock(3, (inner) => {
          inner.writeByte(1)
          inner.writeByte(2)
          inner.writeByte(3)
        }),
      ),
    ).toEqual([3, 3, 1, 2, 3])
    const bytes = write((w) =>
      w.writeObjectBlock(8, (inner) => {
        for (let i = 0; i < 200; i++) inner.writeByte(7)
      }),
    )
    expect(bytes.slice(0, 3)).toEqual([8, 200, 1])
    expect(bytes).toHaveLength(203)
  })

  it('encodes base64 from raw bytes', () => {
    expect(bytesToBase64(new Uint8Array([83, 0, 255]))).toBe('UwD/')
    expect(bytesToBase64(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA==')
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
  })
})

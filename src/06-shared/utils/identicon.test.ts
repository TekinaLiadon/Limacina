import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateIdenticon } from './identicon'

interface RectCall {
  x: number
  y: number
  style: string
}

class FakeCanvasContext {
  fillStyle = ''
  readonly rects: RectCall[] = []
  readonly circles: { x: number; y: number; r: number }[] = []

  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, style: this.fillStyle })
    void w
    void h
  }

  beginPath(): void {}

  arc(x: number, y: number, r: number): void {
    this.circles.push({ x, y, r })
  }

  fill(): void {}

  save(): void {}

  restore(): void {}
}

const SIZE = 100
const BLOCK = 20

const attachCanvas = (context: FakeCanvasContext | null): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,fake')
}

const cellRects = (context: FakeCanvasContext): RectCall[] => context.rects.slice(1)

describe('generateIdenticon', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the canvas data url', () => {
    attachCanvas(new FakeCanvasContext())
    expect(generateIdenticon('steve')).toBe('data:image/png;base64,fake')
  })

  it('returns an empty string when the canvas context is unavailable', () => {
    attachCanvas(null)
    expect(generateIdenticon('steve')).toBe('')
  })

  it('draws deterministic cells for the same username', () => {
    const first = new FakeCanvasContext()
    const second = new FakeCanvasContext()
    attachCanvas(first)
    generateIdenticon('steve')
    attachCanvas(second)
    generateIdenticon('steve')
    expect(cellRects(first)).toEqual(cellRects(second))
  })

  it('ignores case and surrounding whitespace of the username', () => {
    const first = new FakeCanvasContext()
    const second = new FakeCanvasContext()
    attachCanvas(first)
    generateIdenticon('  Steve ')
    attachCanvas(second)
    generateIdenticon('steve')
    expect(cellRects(first)).toEqual(cellRects(second))
  })

  it('draws different patterns for different usernames', () => {
    const first = new FakeCanvasContext()
    const second = new FakeCanvasContext()
    attachCanvas(first)
    generateIdenticon('aaaa')
    attachCanvas(second)
    generateIdenticon('zzzz')
    expect(cellRects(first)).not.toEqual(cellRects(second))
  })

  it('mirrors every cell to the opposite half', () => {
    const context = new FakeCanvasContext()
    attachCanvas(context)
    generateIdenticon('steve')

    const cells = cellRects(context)
    expect(cells.length % 2).toBe(0)
    for (const rect of cells) {
      const mirrored = cells.find(
        (candidate) =>
          candidate.x === SIZE - rect.x - BLOCK &&
          candidate.y === rect.y &&
          candidate.style === rect.style,
      )
      expect(mirrored).toBeDefined()
    }
  })

  it('clips the picture with a centered circle', () => {
    const context = new FakeCanvasContext()
    attachCanvas(context)
    generateIdenticon('steve')

    expect(context.circles).toEqual([{ x: SIZE / 2, y: SIZE / 2, r: SIZE / 2 }])
    expect(context.rects[0]).toEqual({ x: 0, y: 0, style: expect.stringContaining('hsl(') })
  })
})

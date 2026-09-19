const GRID = 5
const BLOCK = 20
const CELL_CHANCE = 0.55

function hashUsername(username: string): number {
  let hash = 2166136261
  for (let index = 0; index < username.length; index += 1) {
    hash ^= username.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createPrng(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function generateIdenticon(username: string): string {
  const prng = createPrng(hashUsername(username.trim().toLowerCase()))
  const hue = Math.floor(prng() * 360)
  const canvas = document.createElement('canvas')
  canvas.width = GRID * BLOCK
  canvas.height = GRID * BLOCK
  const context = canvas.getContext('2d')
  if (!context) return ''

  const size = GRID * BLOCK
  context.fillStyle = `hsl(${hue}, 48%, 90%)`
  context.fillRect(0, 0, size, size)

  const pickCellColor = (value: number): string => {
    if (value < 0.4) return `hsl(${hue}, 60%, 42%)`
    if (value < 0.75) return `hsl(${hue}, 68%, 54%)`
    return `hsl(${(hue + 28) % 360}, 66%, 58%)`
  }

  const half = Math.ceil(GRID / 2)
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < half; x += 1) {
      if (prng() < CELL_CHANCE) {
        context.fillStyle = pickCellColor(prng())
        context.fillRect(x * BLOCK, y * BLOCK, BLOCK, BLOCK)
        context.fillRect((GRID - 1 - x) * BLOCK, y * BLOCK, BLOCK, BLOCK)
      }
    }
  }

  context.save()
  context.globalCompositeOperation = 'destination-in'
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.fill()
  context.restore()

  return canvas.toDataURL('image/png')
}

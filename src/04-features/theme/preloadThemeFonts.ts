interface FontSpec {
  family: string
  weights: number[]
}

const THEME_FONT_SPECS: FontSpec[] = [
  { family: 'Inter', weights: [400, 500] },
  { family: 'Onest', weights: [400, 500] },
  { family: 'Inter Tight', weights: [400, 500] },
  { family: 'Jost', weights: [300, 400, 500] },
  { family: 'Manrope', weights: [400, 500] },
  { family: 'JetBrains Mono', weights: [400, 500] },
]

const SAMPLE_TEXT = 'АбвЯяё AbcZz 0123'

export async function preloadThemeFonts(): Promise<void> {
  const loads: Promise<FontFace[]>[] = []
  for (const { family, weights } of THEME_FONT_SPECS) {
    for (const weight of weights) {
      loads.push(document.fonts.load(`${weight} 16px "${family}"`, SAMPLE_TEXT))
    }
  }
  await Promise.all(loads)
}

import JSZip from 'jszip'
import type { CpmAnimationFileEntry } from '@/04-features/cpm-convert/cpmAnimationJsonWriter'
import femaleBodyAnimations from './assets/female-body.animations.json?raw'
import femaleBodyConfig from './assets/female-body.config.json?raw'
import femaleBodyPreviewBase64 from './assets/female-body.preview.png.b64?raw'
import type { PresetCatalogEntry, PresetCatalogSource, PresetPackageData } from './presetCatalog'
import type { PresetMeta } from './presetTypes'

const femaleBodyMeta: PresetMeta = {
  name: 'Женское тело',
  slug: 'female-body',
  skinType: 'both',
  auxRegions: [
    { name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 },
    { name: 'body-jacket', sx: 16, sy: 32, ex: 40, ey: 48 },
  ],
}
const femaleBodyPreviewUrl = `data:image/png;base64,${femaleBodyPreviewBase64}`
const femaleBodyAnimationFiles = JSON.parse(femaleBodyAnimations) as CpmAnimationFileEntry[]

const decodeBase64Bytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const fetchFemaleBody = async (): Promise<PresetPackageData> => {
  const zip = new JSZip()
  zip.file('config.json', femaleBodyConfig)
  for (const entry of femaleBodyAnimationFiles) {
    zip.file(`animations/${entry.fileName}`, JSON.stringify(entry.body))
  }
  const projectData = await zip.generateAsync({ type: 'uint8array' })
  return {
    projectData,
    metaData: new TextEncoder().encode(JSON.stringify(femaleBodyMeta)),
    previewSkin: decodeBase64Bytes(femaleBodyPreviewBase64),
  }
}

export const builtinPresetSource: PresetCatalogSource = {
  list: (): Promise<PresetCatalogEntry[]> =>
    Promise.resolve([
      {
        slug: femaleBodyMeta.slug,
        name: femaleBodyMeta.name,
        skinType: femaleBodyMeta.skinType,
        previewUrl: femaleBodyPreviewUrl,
      },
    ]),
  fetch: (slug: string): Promise<PresetPackageData> => {
    if (slug !== femaleBodyMeta.slug) return Promise.reject(new Error(`Пресет "${slug}" недоступен`))
    return fetchFemaleBody()
  },
}

export interface CpmChildElement {
  name: string
  show?: boolean
  texture?: boolean
  textureSize?: number
  offset?: { x: number; y: number; z: number }
  pos?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  size?: { x: number; y: number; z: number }
  rscale?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  u?: number
  v?: number
  color?: string
  mirror?: boolean
  mcScale?: number
  glow?: boolean
  recolor?: boolean
  hidden?: boolean
  singleTex?: boolean
  extrude?: boolean
  locked?: boolean
  nameColor?: number
  faceUV?: unknown
  itemRenderer?: string
  copyTransform?: unknown
  storeID?: number
  children?: CpmChildElement[]
}

export interface CpmConfig {
  version: number
  skinType?: string
  elements?: CpmConfigElement[]
  textures?: Record<string, { animatedTexs?: unknown[] }>
  animations?: Record<string, unknown>
  description?: { name?: string; desc?: string; copyProtection?: string; uuid?: string }
  tags?: Record<string, Record<string, string[]>>
  templates?: { link?: string; args?: unknown }[]
  scaling?: number
  scalingEx?: Record<string, unknown>
  firstPersonHand?: Record<string, Record<string, { x: number; y: number; z: number }>>
  removeBedOffset?: boolean
  removeArmorOffset?: boolean
  hideHeadIfSkull?: boolean
  enableInvisGlow?: boolean
}

export interface CpmConfigElement {
  id: string
  customPart?: boolean
  dup?: boolean
  storeID?: number
  show?: boolean
  disableVanillaAnim?: boolean
  name?: string
  pos?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  children?: CpmChildElement[]
}

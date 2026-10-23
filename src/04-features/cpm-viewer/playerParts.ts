import type { CPMVec3 } from '@/05-entities'

export interface PlayerPartDefinition {
  id: string
  ordinal: number
  pivot: CPMVec3
}

export const VANILLA_PLAYER_PARTS: PlayerPartDefinition[] = [
  { id: 'head', ordinal: 0, pivot: { x: 0, y: 24, z: 0 } },
  { id: 'body', ordinal: 1, pivot: { x: 0, y: 24, z: 0 } },
  { id: 'left_arm', ordinal: 2, pivot: { x: 5, y: 22, z: 0 } },
  { id: 'right_arm', ordinal: 3, pivot: { x: -5, y: 22, z: 0 } },
  { id: 'left_leg', ordinal: 4, pivot: { x: 2, y: 12, z: 0 } },
  { id: 'right_leg', ordinal: 5, pivot: { x: -2, y: 12, z: 0 } },
]

export const CUSTOM_PART_ORDINAL = 6

export const PLAYER_PART_ORDINALS: Record<string, number> = Object.fromEntries([
  ...VANILLA_PLAYER_PARTS.map((part) => [part.id, part.ordinal]),
  ['custom_part', CUSTOM_PART_ORDINAL],
])

const EXTRA_ROOT_PIVOTS: Record<string, CPMVec3> = {
  cape: { x: 0, y: 24, z: 0 },
  elytra_left: { x: 0, y: 24, z: 0 },
  elytra_right: { x: 0, y: 24, z: 0 },
  armor_helmet: { x: 0, y: 24, z: 0 },
  armor_body: { x: 0, y: 24, z: 0 },
  armor_left_arm: { x: 5, y: 22, z: 0 },
  armor_right_arm: { x: -5, y: 22, z: 0 },
  armor_leggings_body: { x: 0, y: 24, z: 0 },
  armor_left_leg: { x: 2, y: 12, z: 0 },
  armor_right_leg: { x: -2, y: 12, z: 0 },
  armor_left_foot: { x: 2, y: 12, z: 0 },
  armor_right_foot: { x: -2, y: 12, z: 0 },
}

export const ROOT_PIVOTS: Record<string, CPMVec3> = {
  ...Object.fromEntries(VANILLA_PLAYER_PARTS.map((part) => [part.id, part.pivot])),
  ...EXTRA_ROOT_PIVOTS,
}

export enum TagType {
  END = 0,
  NEW_ANIM = 1,
  NEW_TRIGGER = 2,
  INIT_BUILTIN_TRIGGER = 3,
  INIT_NAMED_TRIGGER = 4,
  INIT_PARAMETER_TRIGGER = 5,
  INIT_STAGED_TRIGGER = 6,
  CONSTANT_FRAME_TIME_FLOAT = 7,
  CONSTANT_FRAME_TIME_BOOLEAN = 8,
  CUBES_TO_CHANNELS = 9,
  CONTROL_INFO = 10,
  GESTURE_BUTTON = 11,
  PARAMETERS = 12,
  INIT_STAGED_ANIM = 13,
}

export enum AnimationType {
  POSE = 0,
  CUSTOM_POSE = 1,
  GESTURE = 2,
  LAYER = 3,
  VALUE_LAYER = 4,
  SETUP = 5,
  FINISH = 6,
}

export enum InterpolatorType {
  POLY_LOOP = 0,
  POLY_SINGLE = 1,
  LINEAR_LOOP = 2,
  LINEAR_SINGLE = 3,
  NO_INTERPOLATE = 4,
  TRIG_LOOP = 5,
  TRIG_SINGLE = 6,
}

export enum VanillaPose {
  CUSTOM = 0, STANDING = 1, WALKING = 2, RUNNING = 3, SNEAKING = 4,
  SWIMMING = 5, FALLING = 6, SLEEPING = 7, RIDING = 8, FLYING = 9,
  DYING = 10, SKULL_RENDER = 11, GLOBAL = 12, CREATIVE_FLYING = 13,
  EATING_LEFT = 14, EATING_RIGHT = 15, RETRO_SWIMMING = 16, JUMPING = 17,
  SNEAK_WALK = 18, PUNCH_LEFT = 19, PUNCH_RIGHT = 20,
  ARMOR_HEAD = 21, ARMOR_BODY = 22, ARMOR_LEGS = 23, ARMOR_BOOTS = 24,
  WEARING_ELYTRA = 25, BOW_LEFT = 26, BOW_RIGHT = 27,
  CROSSBOW_LEFT = 28, CROSSBOW_RIGHT = 29,
  CROSSBOW_CH_LEFT = 30, CROSSBOW_CH_RIGHT = 31,
  TRIDENT_LEFT = 32, TRIDENT_RIGHT = 33, TRIDENT_SPIN = 34,
  SPYGLASS_LEFT = 35, SPYGLASS_RIGHT = 36,
  HOLDING_LEFT = 37, HOLDING_RIGHT = 38,
  WEARING_SKULL = 39, BLOCKING_LEFT = 40, BLOCKING_RIGHT = 41,
  PARROT_LEFT = 42, PARROT_RIGHT = 43,
  HURT = 44, ON_FIRE = 45, FREEZING = 46,
  ON_LADDER = 47, CLIMBING_ON_LADDER = 48,
  SPEAKING = 49, TOOT_HORN_LEFT = 50, TOOT_HORN_RIGHT = 51,
  IN_GUI = 52, FIRST_PERSON_MOD = 53, VOICE_MUTED = 54,
  VR_FIRST_PERSON = 55, VR_THIRD_PERSON_SITTING = 56, VR_THIRD_PERSON_STANDING = 57,
  FIRST_PERSON_HAND = 58, HEALTH = 59, HUNGER = 60, AIR = 61,
  IN_MENU = 62, INVISIBLE = 63, LIGHT = 64,
  HEAD_ROTATION_YAW = 65, HEAD_ROTATION_PITCH = 66,
  BRUSH_LEFT = 67, BRUSH_RIGHT = 68, CRAWLING = 69,
  SPEAR_LEFT = 70, SPEAR_RIGHT = 71,
}

export enum StageType {
  SETUP = 0,
  PLAY = 1,
  FINISH = 2,
}

export enum GestureButtonType {
  POSE = 0,
  GESTURE = 1,
  BOOL_PARAMETER_TOGGLE = 2,
  VALUE_PARAMETER_SLIDER = 3,
  DROPDOWN = 4,
}

export enum InterpolatorChannel {
  POS_X = 0, POS_Y = 1, POS_Z = 2,
  ROT_X = 3, ROT_Y = 4, ROT_Z = 5,
  COLOR_R = 6, COLOR_G = 7, COLOR_B = 8,
  SCALE_X = 9, SCALE_Y = 10, SCALE_Z = 11,
}

export const INTERPOLATOR_CHANNEL_COUNT = 12

export const DYNAMIC_DURATION_MUL = 1000
export const DYNAMIC_DURATION_DIV = 1001

export const TRIGGER_FLAGS = {
  LAYER_CTRL: 1 << 0,
  LOOPING: 1 << 1,
  BITMASK: 1 << 2,
  PARAM_INTERPOLATE: 1 << 3,
  MUST_FINISH: 1 << 4,
}

export const GESTURE_BUTTON_FLAGS = {
  LAYER_CTRL: 1 << 0,
  COMMAND_CTRL: 1 << 1,
  PROPERTY: 1 << 2,
  CONDITIONAL: 1 << 3,
  HIDDEN: 1 << 4,
}

export const ANIM_FLAGS = {
  ADDITIVE: 1 << 0,
}

export function parseAnimationType(filename: string): AnimationType {
  const prefix = filename.split('_')[0]
  if (prefix === 'v') return AnimationType.POSE
  if (prefix === 'c') return AnimationType.CUSTOM_POSE
  if (prefix === 'g') {
    const name = filename.substring(2)
    if (name.startsWith('$layer$')) return AnimationType.LAYER
    if (name.startsWith('$value$')) return AnimationType.VALUE_LAYER
    if (name.startsWith('$pre$')) return AnimationType.SETUP
    if (name.startsWith('$post$')) return AnimationType.FINISH
    return AnimationType.GESTURE
  }
  return AnimationType.GESTURE
}

export function parseVanillaPose(filename: string): VanillaPose | null {
  if (!filename.startsWith('v_')) return null
  const poseName = filename.split('_')[1]
  for (const [key, val] of Object.entries(VanillaPose)) {
    if (typeof val === 'number' && poseName.toLowerCase().startsWith(key.toLowerCase())) {
      return val as VanillaPose
    }
  }
  return null
}

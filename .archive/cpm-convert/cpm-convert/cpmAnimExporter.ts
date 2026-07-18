import {
  AnimationType, InterpolatorType, VanillaPose,
  StageType, GestureButtonType, InterpolatorChannel,
  INTERPOLATOR_CHANNEL_COUNT, DYNAMIC_DURATION_DIV,
  GESTURE_BUTTON_FLAGS,
  parseAnimationType, parseVanillaPose,
} from './cpmAnimEnums'
import type {
  AnimTrigger, SerializedAnim,
  GestureButtonData, ModelPartAnimation,
  AnimFrameFloat,
} from './cpmAnimSerializer'

interface AnimJsonComponent {
  storeID?: number
  pos?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  color?: string
  show?: boolean
  scale?: { x: number; y: number; z: number }
}

function parseInterpolatorType(s?: string): InterpolatorType {
  if (!s) return InterpolatorType.POLY_LOOP
  const map: Record<string, InterpolatorType> = {
    poly_loop: InterpolatorType.POLY_LOOP,
    poly_single: InterpolatorType.POLY_SINGLE,
    linear_loop: InterpolatorType.LINEAR_LOOP,
    linear_single: InterpolatorType.LINEAR_SINGLE,
    no_interpolate: InterpolatorType.NO_INTERPOLATE,
    trig_loop: InterpolatorType.TRIG_LOOP,
    trig_single: InterpolatorType.TRIG_SINGLE,
  }
  return map[s.toLowerCase()] ?? InterpolatorType.POLY_LOOP
}

function parseColor(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 255, g: 255, b: 255 }
  const rgb = parseInt(hex, 16)
  return {
    r: (rgb >> 16) & 0xFF,
    g: (rgb >> 8) & 0xFF,
    b: rgb & 0xFF,
  }
}

export function exportAnimations(
  animationFiles: Record<string, { name?: string; hidden?: boolean; frames?: unknown[]; duration?: number; priority?: number; loop?: boolean; interpolator?: string; additive?: boolean; mustFinish?: boolean; layerDefault?: number; order?: number; isProperty?: boolean; command?: boolean; layerControlled?: boolean; maxValue?: number; interpolateVal?: boolean }>,
  _animEnc?: { freeLayers?: string[]; defaultValues?: Record<string, boolean> },
): ModelPartAnimation | null {
  const animNames = Object.keys(animationFiles)
  if (animNames.length === 0) return null

  const triggers: AnimTrigger[] = []
  const animations: SerializedAnim[] = []
  const gestureButtons: GestureButtonData[] = []
  const stagedAnims: number[] = []

  let poseCounter = 1
  let gestureCounter = 1
  const syncDefaults: number[] = [0, 0]
  let bitParam = 0
  let bitMask = 0
  let bitCount = 0

  function allocByteSync(): number {
    const id = syncDefaults.length
    syncDefaults.push(0)
    return id
  }

  function allocBitSync(defaultValue: boolean): { param: number; mask: number } {
    if (bitCount === 0) {
      if (bitParam !== 0) syncDefaults[bitParam] = bitMask
      bitParam = allocByteSync()
      bitMask = 0
      bitCount = 8
    }
    bitCount--
    if (defaultValue) bitMask |= (1 << bitCount)
    const valMask = 1 << bitCount
    return { param: bitParam, mask: valMask }
  }

  function finishParams(): { syncDefault: number[]; localDefault: number[] } {
    if (bitParam !== 0) syncDefaults[bitParam] = bitMask
    return { syncDefault: [...syncDefaults], localDefault: [] }
  }

  const allTriggers = new Map<string, number>()

  for (const animName of animNames) {
    const animData = animationFiles[animName]
    if (!animData) continue

    const displayName = animData.name ?? 'Unnamed'
    const type = parseAnimationType(animName)
    const additive = animData.additive ?? false
    const duration = animData.duration ?? 1000
    const priority = animData.priority ?? 0
    const loop = animData.loop ?? false
    const intType = parseInterpolatorType(animData.interpolator)
    const layerDefault = animData.layerDefault ?? 0
    const mustFinish = animData.mustFinish ?? false
    const hidden = animData.hidden ?? false
    const isProperty = animData.isProperty ?? false
    const command = animData.command ?? false
    const layerControlled = animData.layerControlled ?? true
    const maxValue = animData.maxValue ?? 100

    const tr: AnimTrigger = {}
    let triggerKey = ''

    if (type === AnimationType.POSE) {
      const pose = parseVanillaPose(animName)
      if (pose != null) {
        tr.pose = pose
        tr.mustFinish = mustFinish
        triggerKey = `pose:${pose}`
      }
    } else if (type === AnimationType.CUSTOM_POSE) {
      tr.anim = AnimationType.CUSTOM_POSE
      tr.parameter = 0
      tr.value = poseCounter++
      tr.looping = false
      triggerKey = `custom:${displayName}`
    } else if (type === AnimationType.GESTURE) {
      tr.anim = AnimationType.GESTURE
      tr.parameter = 1
      tr.value = gestureCounter++
      tr.looping = loop
      tr.mustFinish = mustFinish
      triggerKey = `gesture:${displayName}`
    } else if (type === AnimationType.LAYER) {
      const bit = allocBitSync(layerDefault > 0.5)
      tr.anim = AnimationType.LAYER
      tr.parameter = bit.param
      tr.value = bit.mask
      tr.bitMask = true
      tr.looping = true
      triggerKey = `layer:${displayName}`
      gestureButtons.push({
        type: GestureButtonType.BOOL_PARAMETER_TOGGLE,
        name: displayName,
        flags: (layerControlled ? GESTURE_BUTTON_FLAGS.LAYER_CTRL : 0) |
          (command ? GESTURE_BUTTON_FLAGS.COMMAND_CTRL : 0) |
          (isProperty ? GESTURE_BUTTON_FLAGS.PROPERTY : 0) |
          (hidden ? GESTURE_BUTTON_FLAGS.HIDDEN : 0),
        parameter: bit.param,
        mask: bit.mask,
      })
    } else if (type === AnimationType.VALUE_LAYER) {
      const param = allocByteSync()
      syncDefaults[param] = Math.round(layerDefault * 255)
      tr.anim = AnimationType.VALUE_LAYER
      tr.parameter = param
      tr.value = 0
      tr.looping = true
      triggerKey = `vlayer:${displayName}`
      gestureButtons.push({
        type: GestureButtonType.VALUE_PARAMETER_SLIDER,
        name: displayName,
        flags: (hidden ? GESTURE_BUTTON_FLAGS.HIDDEN : 0),
        parameter: param,
        maxValue,
      })
    } else if (type === AnimationType.SETUP || type === AnimationType.FINISH) {
      tr.stage = type === AnimationType.SETUP ? StageType.SETUP : StageType.FINISH
      tr.stagingID = 0
      tr.mustFinish = mustFinish
      triggerKey = `stage:${type}:${displayName}`
    }

    if (!allTriggers.has(triggerKey)) {
      allTriggers.set(triggerKey, triggers.length)
      triggers.push(tr)
    }
    const triggerID = allTriggers.get(triggerKey)!

    const effectiveDuration =
      (type === AnimationType.VALUE_LAYER || (tr.pose != null && tr.pose >= VanillaPose.HEALTH && tr.pose <= VanillaPose.AIR))
        ? DYNAMIC_DURATION_DIV
        : duration

    const frames = (animData.frames ?? []) as { components?: AnimJsonComponent[] }[]
    const frameCount = frames.length

    const cubeIDs: number[] = []
    const cubeIdToChannels = new Map<number, Map<InterpolatorChannel | null, number>>()
    const channels: AnimFrameFloat[] = []

    function getOrCreateCubeChannels(cubeId: number): Map<InterpolatorChannel | null, number> {
      if (cubeIdToChannels.has(cubeId)) return cubeIdToChannels.get(cubeId)!
      const map = new Map<InterpolatorChannel | null, number>()
      cubeIdToChannels.set(cubeId, map)

      const chBase = channels.length
      for (let i = 0; i < INTERPOLATOR_CHANNEL_COUNT; i++) {
        map.set(i as InterpolatorChannel, chBase + i)
        channels.push({ channelID: chBase + i, values: new Array(frameCount).fill(0) })
      }
      map.set(null, chBase + INTERPOLATOR_CHANNEL_COUNT)
      channels.push({ channelID: chBase + INTERPOLATOR_CHANNEL_COUNT, values: new Array(frameCount).fill(0) })
      cubeIDs.push(cubeId)
      return map
    }

    for (let fi = 0; fi < frameCount; fi++) {
      const frame = frames[fi]
      const components = frame.components ?? []
      for (const comp of components) {
        const cubeId = comp.storeID ?? 0
        if (cubeId === 0) continue
        const cubeCh = getOrCreateCubeChannels(cubeId)

        const pos = comp.pos ?? { x: 0, y: 0, z: 0 }
        const rot = comp.rotation ?? { x: 0, y: 0, z: 0 }
        const scl = comp.scale ?? { x: 1, y: 1, z: 1 }
        const color = parseColor(comp.color)
        const show = comp.show ?? true

        channels[cubeCh.get(InterpolatorChannel.POS_X)!].values[fi] = pos.x
        channels[cubeCh.get(InterpolatorChannel.POS_Y)!].values[fi] = pos.y
        channels[cubeCh.get(InterpolatorChannel.POS_Z)!].values[fi] = pos.z
        channels[cubeCh.get(InterpolatorChannel.ROT_X)!].values[fi] = rot.x
        channels[cubeCh.get(InterpolatorChannel.ROT_Y)!].values[fi] = rot.y
        channels[cubeCh.get(InterpolatorChannel.ROT_Z)!].values[fi] = rot.z
        channels[cubeCh.get(InterpolatorChannel.COLOR_R)!].values[fi] = color.r
        channels[cubeCh.get(InterpolatorChannel.COLOR_G)!].values[fi] = color.g
        channels[cubeCh.get(InterpolatorChannel.COLOR_B)!].values[fi] = color.b
        channels[cubeCh.get(InterpolatorChannel.SCALE_X)!].values[fi] = scl.x
        channels[cubeCh.get(InterpolatorChannel.SCALE_Y)!].values[fi] = scl.y
        channels[cubeCh.get(InterpolatorChannel.SCALE_Z)!].values[fi] = scl.z
        channels[cubeCh.get(null)!].values[fi] = show ? 1 : 0
      }
    }

    const floatGroups = new Map<string, AnimFrameFloat[]>()
    const boolGroup: AnimFrameFloat[] = []

    for (const ch of channels) {
      if (ch.channelID % (INTERPOLATOR_CHANNEL_COUNT + 1) === INTERPOLATOR_CHANNEL_COUNT) {
        boolGroup.push(ch)
      } else {
        const key = intType.toString()
        if (!floatGroups.has(key)) floatGroups.set(key, [])
        floatGroups.get(key)!.push(ch)
      }
    }

    const floatFrames = Array.from(floatGroups.entries()).map(([key, frames]) => ({
      intType: parseInt(key) as InterpolatorType,
      frames,
    }))

    animations.push({
      triggerID,
      priority,
      duration: effectiveDuration,
      cubeIDs,
      additive,
      floatFrames,
      boolFrames: boolGroup,
    })
  }

  return {
    controlInfo: {
      blankId: 0,
      resetId: syncDefaults.length > 0 ? syncDefaults.length : 0,
      modelProfilesId: undefined,
    },
    parameters: finishParams(),
    triggers,
    animations,
    gestureButtons,
    stagedAnims,
  }
}

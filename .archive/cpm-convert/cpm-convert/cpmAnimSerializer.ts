import { CpmBinaryWriter } from './cpmBinaryWriter'
import {
  TagType, AnimationType, InterpolatorType, VanillaPose,
  StageType, GestureButtonType,
  INTERPOLATOR_CHANNEL_COUNT, ANIM_FLAGS,
  TRIGGER_FLAGS,
} from './cpmAnimEnums'

export interface AnimTrigger {
  pose?: VanillaPose
  anim?: AnimationType
  looping?: boolean
  layerCtrl?: boolean
  parameter?: number
  value?: number
  gid?: number
  bitMask?: boolean
  parameterInterpolate?: boolean
  mustFinish?: boolean
  stage?: StageType
  stagingID?: number
}

export interface AnimFrameFloat {
  channelID: number
  values: number[]
}

export interface AnimFrameBool {
  channelID: number
  values: boolean[]
}

export interface SerializedAnim {
  triggerID: number
  priority: number
  duration: number
  cubeIDs: number[]
  additive: boolean
  floatFrames: { intType: InterpolatorType; frames: AnimFrameFloat[] }[]
  boolFrames: AnimFrameFloat[]
}

export interface AnimControlInfo {
  blankId: number
  resetId: number
  modelProfilesId?: string
}

export interface AnimParamDetails {
  syncDefault: number[]
  localDefault: number[]
}

export interface GestureButtonData {
  type: GestureButtonType
  name: string
  flags: number
  id?: number
  gid?: number
  gestureTimeout?: number
  parameter?: number
  mask?: number
  maxValue?: number
  options?: string[]
}

export interface ModelPartAnimation {
  controlInfo: AnimControlInfo
  parameters?: AnimParamDetails
  triggers: AnimTrigger[]
  animations: SerializedAnim[]
  gestureButtons: GestureButtonData[]
  stagedAnims: number[]
}

function writeTrigger(w: CpmBinaryWriter, tr: AnimTrigger): void {
  w.writeObjectBlock(TagType.NEW_TRIGGER, () => {})

  if (tr.pose != null) {
    w.writeObjectBlock(TagType.INIT_BUILTIN_TRIGGER, (w) => {
      w.writeEnum(tr.pose!)
      let flags = 0
      if (tr.mustFinish) flags |= TRIGGER_FLAGS.MUST_FINISH
      w.writeByte(flags)
    })
  } else if (tr.anim === AnimationType.POSE || tr.anim === AnimationType.GESTURE) {
    w.writeObjectBlock(TagType.INIT_NAMED_TRIGGER, (w) => {
      w.writeEnum(tr.anim! as number)
      let flags = 0
      if (tr.bitMask) flags |= TRIGGER_FLAGS.BITMASK
      if (tr.looping) flags |= TRIGGER_FLAGS.LOOPING
      if (tr.layerCtrl) flags |= TRIGGER_FLAGS.LAYER_CTRL
      if (tr.mustFinish) flags |= TRIGGER_FLAGS.MUST_FINISH
      w.writeByte(flags)
      w.writeByte(tr.value ?? 0)
      if (tr.layerCtrl) w.writeByte(tr.gid ?? 0)
    })
  } else if (tr.parameter != null) {
    w.writeObjectBlock(TagType.INIT_PARAMETER_TRIGGER, (w) => {
      w.writeEnum(tr.anim! as number)
      let flags = 0
      if (tr.bitMask) flags |= TRIGGER_FLAGS.BITMASK
      if (tr.looping) flags |= TRIGGER_FLAGS.LOOPING
      if (tr.parameterInterpolate) flags |= TRIGGER_FLAGS.PARAM_INTERPOLATE
      if (tr.mustFinish) flags |= TRIGGER_FLAGS.MUST_FINISH
      w.writeByte(flags)
      w.writeVarInt(tr.parameter!)
      w.writeByte(tr.value ?? 0)
    })
  } else if (tr.stage != null) {
    w.writeObjectBlock(TagType.INIT_STAGED_TRIGGER, (w) => {
      w.writeEnum(tr.stage! as number)
      w.writeVarInt(tr.stagingID ?? 0)
      let flags = 0
      if (tr.mustFinish) flags |= TRIGGER_FLAGS.MUST_FINISH
      w.writeByte(flags)
    })
  }
}

function writeCubeMaps(w: CpmBinaryWriter, cubes: number[], additive: boolean): void {
  if (cubes.length === 0) return
  w.writeObjectBlock(TagType.CUBES_TO_CHANNELS, (w) => {
    w.writeVarInt(cubes.length)
    w.writeVarInt(INTERPOLATOR_CHANNEL_COUNT)
    let flags = 0
    if (additive) flags |= ANIM_FLAGS.ADDITIVE
    w.writeVarInt(flags)
    for (const id of cubes) {
      w.writeVarInt(id)
    }
  })
}

function writeConstantTimeFloat(
  w: CpmBinaryWriter,
  intType: InterpolatorType,
  frameCount: number,
  frames: AnimFrameFloat[],
): void {
  if (frames.length === 0) return
  w.writeObjectBlock(TagType.CONSTANT_FRAME_TIME_FLOAT, (w) => {
    w.writeEnum(intType)
    w.writeVarInt(frameCount)
    w.writeVarInt(frames.length)
    for (const f of frames) {
      w.writeVarInt(f.channelID)
      for (const v of f.values) {
        w.writeVarFloat(v)
      }
    }
  })
}

function writeConstantTimeBool(
  w: CpmBinaryWriter,
  frameCount: number,
  frames: AnimFrameFloat[],
): void {
  if (frames.length === 0) return
  w.writeObjectBlock(TagType.CONSTANT_FRAME_TIME_BOOLEAN, (w) => {
    w.writeVarInt(frameCount)
    w.writeVarInt(frames.length)
    for (const f of frames) {
      w.writeVarInt(f.channelID)
      writeBoolArray(w, frameCount, f.values.map(v => v !== 0))
    }
  })
}

function writeBoolArray(w: CpmBinaryWriter, size: number, data: boolean[]): void {
  for (let i = 0; i < size; i += 8) {
    let flags = 0
    for (let j = 0; j < 8 && i + j < size; j++) {
      if (data[i + j]) flags |= (1 << j)
    }
    w.writeByte(flags)
  }
}

function writeGestureButton(w: CpmBinaryWriter, btn: GestureButtonData): void {
  w.writeObjectBlock(TagType.GESTURE_BUTTON, (w) => {
    w.writeEnum(btn.type)
    w.writeUtf(btn.name)
    w.writeByte(btn.flags)
    if (btn.id != null) w.writeByte(btn.id)
    if (btn.gid != null) w.writeByte(btn.gid)
    if (btn.gestureTimeout != null) w.writeVarInt(btn.gestureTimeout)
    if (btn.parameter != null) w.writeVarInt(btn.parameter)
    if (btn.mask != null) w.writeByte(btn.mask)
    if (btn.maxValue != null) w.writeByte(btn.maxValue)
    if (btn.options != null) {
      w.writeByte(btn.options.length)
      for (const opt of btn.options) {
        w.writeUtf(opt)
      }
    }
  })
}

function writeAnimation(w: CpmBinaryWriter, anim: SerializedAnim): void {
  w.writeObjectBlock(TagType.NEW_ANIM, (w) => {
    w.writeVarInt(anim.triggerID)
    w.writeSignedVarInt(anim.priority)
    w.writeVarInt(anim.duration)
  })

  writeCubeMaps(w, anim.cubeIDs, anim.additive)

  for (const group of anim.floatFrames) {
    writeConstantTimeFloat(w, group.intType, group.frames[0]?.values.length ?? 0, group.frames)
  }

  const boolGroup = anim.boolFrames
  if (boolGroup.length > 0) {
    writeConstantTimeBool(w, boolGroup[0].values.length, boolGroup)
  }
}

export function writeAnimationPart(w: CpmBinaryWriter, part: ModelPartAnimation): void {
  w.writeObjectBlock(23, (w) => {
    w.writeObjectBlock(TagType.CONTROL_INFO, (w) => {
      w.writeByte(part.controlInfo.blankId)
      w.writeByte(part.controlInfo.resetId)
      if (part.controlInfo.modelProfilesId == null) {
        w.writeVarInt(0)
      } else {
        w.writeUtf(part.controlInfo.modelProfilesId)
      }
    })

    if (part.parameters) {
      w.writeObjectBlock(TagType.PARAMETERS, (w) => {
        writeByteArray(w, part.parameters!.syncDefault)
        writeByteArray(w, part.parameters!.localDefault)
      })
    }

    for (const tr of part.triggers) {
      writeTrigger(w, tr)
    }

    for (const anim of part.animations) {
      writeAnimation(w, anim)
    }

    for (const btn of part.gestureButtons) {
      writeGestureButton(w, btn)
    }

    for (const id of part.stagedAnims) {
      w.writeObjectBlock(TagType.INIT_STAGED_ANIM, (w) => {
        w.writeVarInt(id)
      })
    }

    w.writeEnum(TagType.END)
    w.writeVarInt(0)
  })
}

function writeByteArray(w: CpmBinaryWriter, data: number[]): void {
  w.writeVarInt(data.length)
  for (const b of data) {
    w.writeByte(b)
  }
}

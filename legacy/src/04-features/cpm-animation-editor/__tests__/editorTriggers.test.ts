import { describe, expect, it } from 'vitest'
import { VANILLA_POSES } from '../../cpm-settings/cpmAnimationParser'
import {
  EDITOR_INTERPOLATOR_OPTIONS,
  EDITOR_KIND_OPTIONS,
  EDITOR_VANILLA_POSE_OPTIONS,
  vanillaPoseHint,
  vanillaPoseName,
} from '../editorTriggers'

describe('editorTriggers', () => {
  it('offers all seven triggers with the confirmed labels', () => {
    expect(EDITOR_KIND_OPTIONS.map((option) => option.title)).toEqual([
      'Жест',
      'Своя поза',
      'Ванильная поза',
      'Слой',
      'Слой-значение',
      'Подготовка',
      'Завершение',
    ])
    expect(EDITOR_KIND_OPTIONS.map((option) => option.value)).toEqual([
      'gesture',
      'custom-pose',
      'vanilla-pose',
      'layer',
      'value-layer',
      'setup',
      'finish',
    ])
  })

  it('offers all seven interpolators', () => {
    expect(EDITOR_INTERPOLATOR_OPTIONS.map((option) => option.value)).toEqual([
      'linear_loop',
      'linear_single',
      'poly_loop',
      'poly_single',
      'trig_loop',
      'trig_single',
      'no',
    ])
  })

  it('lists vanilla poses without the custom entry and service constants', () => {
    const titles = EDITOR_VANILLA_POSE_OPTIONS.map((option) => option.title)
    expect(titles).not.toContain('custom')
    expect(titles).not.toContain('1000')
    expect(titles).not.toContain('1001')
    expect(titles).toContain('standing')
    expect(titles).toContain('spear_right')
    expect(titles).toHaveLength(VANILLA_POSES.length - 1)
  })

  it('maps vanilla pose options to their enum indexes', () => {
    const indexes = EDITOR_VANILLA_POSE_OPTIONS.map((option) => Number(option.value))
    expect(indexes[0]).toBe(1)
    expect(indexes[indexes.length - 1]).toBe(VANILLA_POSES.length - 1)
    expect(indexes).toEqual(VANILLA_POSES.slice(1).map((_, index) => index + 1))
  })

  it('resolves a pose name by its enum index', () => {
    expect(vanillaPoseName(1)).toBe('standing')
    expect(vanillaPoseName(VANILLA_POSES.indexOf('punch_left'))).toBe('punch_left')
    expect(vanillaPoseName(0)).toBeNull()
    expect(vanillaPoseName(-1)).toBeNull()
    expect(vanillaPoseName(999)).toBeNull()
  })

  it('hints the multiplier duration only for state-driven poses', () => {
    expect(vanillaPoseHint(VANILLA_POSES.indexOf('punch_left'))).toContain('множитель')
    expect(vanillaPoseHint(VANILLA_POSES.indexOf('head_rotation_yaw'))).toContain('множитель')
    expect(vanillaPoseHint(VANILLA_POSES.indexOf('standing'))).toBeNull()
    expect(vanillaPoseHint(null)).toBeNull()
    expect(vanillaPoseHint(999)).toBeNull()
  })
})

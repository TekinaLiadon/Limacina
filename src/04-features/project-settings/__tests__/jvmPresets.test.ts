import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  applyJvmPreset,
  DEFAULT_PRESET_ID,
  detectActivePresetId,
  isPresetAvailable,
  splitJvmArgs,
  useJvmPresets,
  validateJvmArgs,
  type JvmPreset,
} from '../jvmPresets'

const G1_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
]

const SERIAL_ARGS = ['-XX:+UseSerialGC', '-XX:+DisableExplicitGC']

const customPreset: JvmPreset = {
  id: 'custom',
  title: 'Custom',
  minJavaVersion: 8,
  args: ['-XX:+UseCustomGC'],
}

describe('splitJvmArgs', () => {
  it('returns an empty list for empty input', () => {
    expect(splitJvmArgs('')).toEqual([])
    expect(splitJvmArgs('   ')).toEqual([])
  })

  it('splits on commas and trims entries', () => {
    expect(splitJvmArgs(' -a , -b ')).toEqual(['-a', '-b'])
  })

  it('splits on whitespace the same way as on commas', () => {
    expect(splitJvmArgs(' -a -b ')).toEqual(['-a', '-b'])
    expect(splitJvmArgs('-a\t-b\n-c')).toEqual(['-a', '-b', '-c'])
  })

  it('splits mixed comma and space separators', () => {
    expect(splitJvmArgs('-a, -b -c,, -d')).toEqual(['-a', '-b', '-c', '-d'])
  })

  it('drops empty entries from trailing separators', () => {
    expect(splitJvmArgs('-a,')).toEqual(['-a'])
    expect(splitJvmArgs(',, -a  , ')).toEqual(['-a'])
  })
})

describe('validateJvmArgs', () => {
  it('accepts plain comma and space separated input', () => {
    expect(validateJvmArgs('')).toBe('')
    expect(validateJvmArgs('-XX:+UseG1GC, -XX:MaxGCPauseMillis=50')).toBe('')
    expect(validateJvmArgs('-XX:+UseG1GC -XX:MaxGCPauseMillis=50')).toBe('')
  })

  it('reports single and double quotes as unsupported characters', () => {
    expect(validateJvmArgs('"-a, b"')).not.toBe('')
    expect(validateJvmArgs("-Dkey='v'")).not.toBe('')
    expect(validateJvmArgs('-a,b"')).not.toBe('')
  })
})

describe('isPresetAvailable', () => {
  const modernPreset: JvmPreset = { ...customPreset, minJavaVersion: 21 }

  it('hides modern presets when the java version is unknown', () => {
    expect(isPresetAvailable(customPreset, null)).toBe(true)
    expect(isPresetAvailable(modernPreset, null)).toBe(false)
  })

  it('compares the preset requirement with the java version', () => {
    expect(isPresetAvailable(modernPreset, 17)).toBe(false)
    expect(isPresetAvailable(modernPreset, 21)).toBe(true)
    expect(isPresetAvailable(modernPreset, 25)).toBe(true)
    expect(isPresetAvailable(customPreset, 8)).toBe(true)
  })
})

describe('detectActivePresetId', () => {
  it('detects the serial preset by its full argument set', () => {
    expect(detectActivePresetId(SERIAL_ARGS.join(', '))).toBe('serial')
  })

  it('detects the serial preset from space-separated input', () => {
    expect(detectActivePresetId(SERIAL_ARGS.join(' '))).toBe('serial')
  })

  it('detects the g1 preset by its full argument set', () => {
    expect(detectActivePresetId(G1_ARGS.join(', '))).toBe('g1')
  })

  it('falls back to the default preset for partial or empty sets', () => {
    expect(detectActivePresetId(G1_ARGS.slice(1).join(', '))).toBe(DEFAULT_PRESET_ID)
    expect(detectActivePresetId('')).toBe(DEFAULT_PRESET_ID)
    expect(detectActivePresetId('-XX:+UseZGC')).toBe(DEFAULT_PRESET_ID)
  })
})

describe('applyJvmPreset', () => {
  it('appends the preset arguments to an empty string', () => {
    expect(applyJvmPreset('', 'serial')).toBe(SERIAL_ARGS.join(', '))
  })

  it('replaces the previous preset arguments with the new ones', () => {
    const result = applyJvmPreset(SERIAL_ARGS.join(', '), 'g1')
    expect(result).toBe(G1_ARGS.join(', '))
  })

  it('replaces space-separated preset arguments with the new ones', () => {
    const result = applyJvmPreset(SERIAL_ARGS.join(' '), 'g1')
    expect(result).toBe(G1_ARGS.join(', '))
    expect(applyJvmPreset(result, 'serial')).toBe(SERIAL_ARGS.join(', '))
  })

  it('keeps custom arguments across preset switches', () => {
    const result = applyJvmPreset('-Dcustom=1, -XX:+UseSerialGC', 'g1')
    expect(result).toContain('-Dcustom=1')
    expect(result).not.toContain('-XX:+UseSerialGC')
    expect(result).toContain('-XX:+UseG1GC')
  })

  it('returns the cleaned arguments for an unknown preset id', () => {
    const result = applyJvmPreset('-Dcustom=1, -XX:+UseSerialGC', 'missing')
    expect(result).toBe('-Dcustom=1')
  })
})

describe('useJvmPresets', () => {
  it('derives the active preset from the config arguments', () => {
    const config = ref({ jvmArgs: SERIAL_ARGS.join(', '), javaVersion: 8 })
    const { activePresetId } = useJvmPresets(config)
    expect(activePresetId.value).toBe('serial')
  })

  it('lists only presets available for the current java version', () => {
    const config = ref({ jvmArgs: '', javaVersion: 8 })
    const { presetOptions } = useJvmPresets(config)
    const values = presetOptions.value.map((option) => option.value)
    expect(values).toEqual([DEFAULT_PRESET_ID, 'g1', 'serial'])
  })

  it('lists modern presets for a modern java version', () => {
    const config = ref({ jvmArgs: '', javaVersion: 21 })
    const { presetOptions } = useJvmPresets(config)
    const values = presetOptions.value.map((option) => option.value)
    expect(values).toEqual([DEFAULT_PRESET_ID, 'g1', 'serial', 'zgc'])
  })

  it('keeps an unavailable preset visible while it is active', () => {
    const config = ref({ jvmArgs: '-XX:+UseZGC', javaVersion: 8 })
    const { presetOptions, activePresetId } = useJvmPresets(config)
    expect(activePresetId.value).toBe(DEFAULT_PRESET_ID)
    const values = presetOptions.value.map((option) => option.value)
    expect(values).toEqual([DEFAULT_PRESET_ID, 'g1', 'serial'])
  })

  it('applies a preset by mutating the config arguments', () => {
    const config = ref({ jvmArgs: '', javaVersion: 21 })
    const { applyPreset } = useJvmPresets(config)
    applyPreset('zgc')
    expect(config.value.jvmArgs).toContain('-XX:+UseZGC')
  })
})

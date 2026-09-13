import { computed, type ComputedRef, type Ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'

export interface JvmPreset {
  id: string
  title: string
  minJavaVersion: number
  args: string[]
}

export const DEFAULT_PRESET_ID = 'default'

const JVM_PRESETS: JvmPreset[] = [
  {
    id: 'g1',
    title: 'Базовая оптимизация',
    minJavaVersion: 8,
    args: [
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
    ],
  },
  {
    id: 'serial',
    title: 'Слабый ПК',
    minJavaVersion: 8,
    args: ['-XX:+UseSerialGC', '-XX:+DisableExplicitGC'],
  },
  {
    id: 'zgc',
    title: 'Максимальная оптимизация',
    minJavaVersion: 21,
    args: [
      '-XX:+UseZGC',
      '-XX:+UseStringDeduplication',
      '-XX:+AlwaysPreTouch',
      '-XX:TrimNativeHeapInterval=5000',
      '-XX:+DisableExplicitGC',
    ],
  },
]

export function splitJvmArgs(raw: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes
    if (char === ',' && !inQuotes) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  args.push(current.trim())
  return args.filter(Boolean)
}

export function isPresetAvailable(preset: JvmPreset, javaVersion: number | null): boolean {
  if (javaVersion === null) return preset.minJavaVersion <= 8
  return javaVersion >= preset.minJavaVersion
}

export function detectActivePresetId(rawArgs: string): string {
  const present = new Set(splitJvmArgs(rawArgs))
  const active = JVM_PRESETS.find((preset) => preset.args.every((arg) => present.has(arg)))
  return active?.id ?? DEFAULT_PRESET_ID
}

export function applyJvmPreset(rawArgs: string, presetId: string): string {
  const kept = splitJvmArgs(rawArgs).filter((arg) =>
    JVM_PRESETS.every((preset) => preset.id === presetId || !preset.args.includes(arg)),
  )
  const target = JVM_PRESETS.find((preset) => preset.id === presetId)
  if (!target) return kept.join(', ')
  const present = new Set(kept)
  const merged = [...kept, ...target.args.filter((arg) => !present.has(arg))]
  return merged.join(', ')
}

export function useJvmPresets(config: Ref<{ jvmArgs: string; javaVersion: number | null }>): {
  presetOptions: ComputedRef<DropdownOption[]>
  activePresetId: ComputedRef<string>
  applyPreset: (presetId: string) => void
} {
  const activePresetId = computed((): string => detectActivePresetId(config.value.jvmArgs))

  const presetOptions = computed((): DropdownOption[] => {
    const options: DropdownOption[] = [{ value: DEFAULT_PRESET_ID, title: 'По умолчанию' }]
    for (const preset of JVM_PRESETS) {
      if (isPresetAvailable(preset, config.value.javaVersion) || preset.id === activePresetId.value) {
        options.push({ value: preset.id, title: preset.title })
      }
    }
    return options
  })

  const applyPreset = (presetId: string): void => {
    config.value.jvmArgs = applyJvmPreset(config.value.jvmArgs, presetId)
  }

  return { presetOptions, activePresetId, applyPreset }
}

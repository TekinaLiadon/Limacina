import type { GameOptions } from '@/05-entities'

export type OptionsPatch = <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => void

export function createOptionsPatch(
  props: { options: GameOptions },
  emit: (event: 'update:options', options: GameOptions) => void,
): OptionsPatch {
  return <K extends keyof GameOptions>(key: K, value: GameOptions[K]): void => {
    emit('update:options', { ...props.options, [key]: value })
  }
}

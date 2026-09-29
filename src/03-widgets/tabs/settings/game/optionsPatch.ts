import type { GameOptions } from '@/05-entities'

export type OptionsPatch = <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => void

export function createOptionsPatch(
  getOptions: () => GameOptions,
  update: (options: GameOptions) => void,
): OptionsPatch {
  return <K extends keyof GameOptions>(key: K, value: GameOptions[K]): void => {
    update({ ...getOptions(), [key]: value })
  }
}

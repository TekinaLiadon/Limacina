import { effectScope } from 'vue'

export type ListenerStop = () => void
export type TrackListenerStop = (stop: ListenerStop) => void
export type RegisterSingletonListeners = (track: TrackListenerStop) => Promise<void> | void

export interface SingletonListeners {
  start: (register: RegisterSingletonListeners) => Promise<void>
  stop: () => void
  isStarted: () => boolean
}

export function createSingletonListeners(): SingletonListeners {
  let started = false
  let starting: Promise<void> | null = null
  let stops: ListenerStop[] = []
  let scope = effectScope(true)

  const releaseTracked = (): void => {
    for (const stop of stops) stop()
    stops = []
    scope.stop()
    scope = effectScope(true)
  }

  const runRegister = async (register: RegisterSingletonListeners): Promise<void> => {
    try {
      await scope.run(async (): Promise<void> => {
        await register((stop: ListenerStop): void => {
          stops.push(stop)
        })
      })
      started = true
    } catch (e: unknown) {
      releaseTracked()
      throw e
    }
  }

  const start = async (register: RegisterSingletonListeners): Promise<void> => {
    if (started) return
    if (starting !== null) return starting
    starting = runRegister(register).finally((): void => {
      starting = null
    })
    return starting
  }

  const stop = (): void => {
    if (!started) return
    started = false
    releaseTracked()
  }

  return {
    start,
    stop,
    isStarted: (): boolean => started,
  }
}

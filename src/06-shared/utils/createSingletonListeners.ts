import { effectScope } from 'vue'

type ListenerStop = () => void
type TrackListenerStop = (stop: ListenerStop) => void
type RegisterSingletonListeners = (track: TrackListenerStop) => Promise<void> | void

type RegistrationRun = {
  interrupted: boolean
}

export interface SingletonListeners {
  start: (register: RegisterSingletonListeners) => Promise<void>
  stop: () => void
  isStarted: () => boolean
}

export function createSingletonListeners(): SingletonListeners {
  let started = false
  let starting: Promise<void> | null = null
  let currentRun: RegistrationRun | null = null
  let stops: ListenerStop[] = []
  let scope = effectScope(true)

  const releaseTracked = (): void => {
    for (const stop of stops) stop()
    stops = []
    scope.stop()
    scope = effectScope(true)
  }

  const runRegister = async (register: RegisterSingletonListeners, run: RegistrationRun): Promise<void> => {
    try {
      await scope.run(async (): Promise<void> => {
        await register((stop: ListenerStop): void => {
          stops.push(stop)
        })
      })
      if (currentRun !== run) return
      if (run.interrupted) {
        releaseTracked()
        return
      }
      started = true
    } catch (e: unknown) {
      if (currentRun === run) releaseTracked()
      throw e
    }
  }

  const launchRegistration = (register: RegisterSingletonListeners): Promise<void> => {
    const run: RegistrationRun = { interrupted: false }
    currentRun = run
    const pending = runRegister(register, run).finally((): void => {
      if (starting === pending) starting = null
      if (currentRun === run) currentRun = null
    })
    starting = pending
    return pending
  }

  const start = async (register: RegisterSingletonListeners): Promise<void> => {
    if (started) return
    if (starting !== null && (currentRun === null || !currentRun.interrupted)) return starting
    return launchRegistration(register)
  }

  const stop = (): void => {
    if (starting !== null && currentRun !== null) {
      currentRun.interrupted = true
      releaseTracked()
      return
    }
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

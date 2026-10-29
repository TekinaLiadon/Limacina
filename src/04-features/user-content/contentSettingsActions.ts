import { type Ref } from 'vue'

export interface ContentConfirmTexts {
  reset: string
  delete: string
}

export interface ConfirmedContentActions {
  runReset: (reset: () => void | Promise<void>) => Promise<void>
  runDelete: (id: number, afterDelete?: (() => Promise<void>) | undefined) => Promise<void>
}

export function createConfirmedContentActions(
  notification: { runConfirmed: (text: string, action: () => Promise<void> | void) => Promise<void> },
  content: { handleDelete: (id: number) => Promise<void> },
  texts: ContentConfirmTexts,
): ConfirmedContentActions {
  return {
    runReset: (reset: () => void | Promise<void>): Promise<void> => notification.runConfirmed(texts.reset, reset),
    runDelete: (id: number, afterDelete?: (() => Promise<void>) | undefined): Promise<void> =>
      notification.runConfirmed(texts.delete, async (): Promise<void> => {
        await content.handleDelete(id)
        await afterDelete?.()
      }),
  }
}

export function createTextureErrorSetter(errorTarget: Ref<string>, message: string): () => void {
  return (): void => {
    errorTarget.value = message
  }
}

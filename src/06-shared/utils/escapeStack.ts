type EscapeHandler = () => void

const escapeStack: EscapeHandler[] = []
let isListenerBound = false

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented) return
  const topHandler = escapeStack[escapeStack.length - 1]
  if (!topHandler) return
  topHandler()
}

export function pushEscapeHandler(handler: EscapeHandler): () => void {
  escapeStack.push(handler)
  if (!isListenerBound) {
    window.addEventListener('keydown', handleWindowKeydown)
    isListenerBound = true
  }
  return (): void => {
    const index = escapeStack.indexOf(handler)
    if (index !== -1) escapeStack.splice(index, 1)
    if (escapeStack.length !== 0 || !isListenerBound) return
    window.removeEventListener('keydown', handleWindowKeydown)
    isListenerBound = false
  }
}

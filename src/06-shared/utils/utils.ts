const arrayExample = new Uint32Array(5)

function makeid(length: number): string {
  let result = ''
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  let counter = 0
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const randomId = (): string => {
  window.crypto.getRandomValues(arrayExample)
  return `re${
    arrayExample[Math.floor(Math.random() * arrayExample.length)]
  }${makeid(2)}`
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

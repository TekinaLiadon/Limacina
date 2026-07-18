import { saveTextFile } from '@/06-shared/api'
import { cpmArrayBufferToBase64 } from './cpmProjectExporter'

export function useCpmConvert() {
  async function cpmToBase64(data: ArrayBuffer): Promise<string> {
    return cpmArrayBufferToBase64(data)
  }

  function base64ToCpm(base64: string): Blob {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: 'application/zip' })
  }

  async function saveBase64ToFile(base64: string, path: string): Promise<void> {
    await saveTextFile(path, base64)
  }

  function downloadBase64File(base64: string, filename: string): void {
    const blob = new Blob([base64], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return { cpmToBase64, base64ToCpm, saveBase64ToFile, downloadBase64File }
}

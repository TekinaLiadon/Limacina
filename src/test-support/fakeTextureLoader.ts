import type { Texture } from 'three'

export interface FakeTextureLoad {
  url: string
  resolve: (texture: Texture) => void
  fail: (error: unknown) => void
}

export function createFakeTextureLoader(loads: FakeTextureLoad[]): new () => {
  load: (
    url: string,
    onLoad: (texture: Texture) => void,
    onProgress?: undefined,
    onError?: (error: unknown) => void,
  ) => void
} {
  return class FakeTextureLoader {
    load(
      url: string,
      onLoad: (texture: Texture) => void,
      _onProgress?: undefined,
      onError?: (error: unknown) => void,
    ): void {
      loads.push({ url, resolve: onLoad, fail: (error) => onError?.(error) })
    }
  }
}

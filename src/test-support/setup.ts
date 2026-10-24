import { CompressionStream, DecompressionStream, ReadableStream } from 'node:stream/web'

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoViewStub(): void {}
}

if (typeof globalThis.CompressionStream === 'undefined') {
  Object.assign(globalThis, { CompressionStream, DecompressionStream, ReadableStream })
}

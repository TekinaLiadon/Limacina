import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    setupFiles: ['src/test-support/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/04-features/**/*.ts', 'src/05-entities/**/*.ts', 'src/06-shared/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-support/**'],
    },
  },
})

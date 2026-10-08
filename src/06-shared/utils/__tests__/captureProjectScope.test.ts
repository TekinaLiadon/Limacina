import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { captureProjectScope } from '../captureProjectScope'

describe('captureProjectScope', () => {
  it('captures the project at creation time', () => {
    const currentProject = ref('Alpha')
    const scope = captureProjectScope((): string => currentProject.value)

    expect(scope.project).toBe('Alpha')
    expect(scope.isCurrent()).toBe(true)
  })

  it('reports a stale scope after the project changes', () => {
    const currentProject = ref('Alpha')
    const scope = captureProjectScope((): string => currentProject.value)

    currentProject.value = 'Beta'
    expect(scope.isCurrent()).toBe(false)
    expect(scope.project).toBe('Alpha')
  })

  it('keeps reporting the captured project after switching back', () => {
    const currentProject = ref('Alpha')
    const scope = captureProjectScope((): string => currentProject.value)

    currentProject.value = 'Beta'
    currentProject.value = 'Alpha'
    expect(scope.isCurrent()).toBe(true)
  })
})

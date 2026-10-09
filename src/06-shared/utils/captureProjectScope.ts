export interface ProjectScope {
  project: string
  isCurrent: () => boolean
}

export function captureProjectScope(getCurrentProject: () => string): ProjectScope {
  const project = getCurrentProject()
  return {
    project,
    isCurrent: (): boolean => getCurrentProject() === project,
  }
}

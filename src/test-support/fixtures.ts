import type { ProjectConfig } from '@/06-shared/types/ipc'

export const makeProjectConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  cpuCores: null,
  online: true,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
  ...overrides,
})

export const STEP_IDS = {
  javaCheck: 'java.check',
  javaDownload: 'java.download',
  javaExtract: 'java.extract',
  filesList: 'files.list',
  filesDownload: 'files.download',
  filesCheck: 'files.check',
  modsList: 'mods.list',
  modsDownload: 'mods.download',
  modsClean: 'mods.clean',
  modsCheck: 'mods.check',
  mcManifest: 'mc.manifest',
  mcVersion: 'mc.version',
  mcJar: 'mc.jar',
  mcLibs: 'mc.libs',
  mcNatives: 'mc.natives',
  mcAssetsIndex: 'mc.assets.index',
  mcAssets: 'mc.assets',
  loader: 'loader',
  launchConfig: 'launch.config',
  launchProcess: 'launch.process',
  launchWindow: 'launch.window',
} as const

export type StepId = (typeof STEP_IDS)[keyof typeof STEP_IDS]

const downloadStepIds: readonly StepId[] = [
  STEP_IDS.javaDownload,
  STEP_IDS.filesDownload,
  STEP_IDS.mcJar,
  STEP_IDS.mcLibs,
  STEP_IDS.mcAssets,
  STEP_IDS.mcNatives,
  STEP_IDS.loader,
  STEP_IDS.modsDownload,
]

const flowEntryStepIds: readonly StepId[] = [STEP_IDS.javaCheck, STEP_IDS.filesList]

export const DOWNLOAD_STEP_IDS: ReadonlySet<string> = new Set(downloadStepIds)

export const FLOW_ENTRY_STEP_IDS: ReadonlySet<string> = new Set(flowEntryStepIds)

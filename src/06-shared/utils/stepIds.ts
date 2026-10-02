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
  legacyJvm: 'legacy.jvm',
  legacyAssets: 'legacy.assets',
  legacyClient: 'legacy.client',
  launchConfig: 'launch.config',
  launchProcess: 'launch.process',
  launchWindow: 'launch.window',
} as const

export type StepId = (typeof STEP_IDS)[keyof typeof STEP_IDS]

export const STEP_CATALOG: Record<StepId, string> = {
  [STEP_IDS.javaCheck]: 'Проверка Java',
  [STEP_IDS.javaDownload]: 'Скачивание Java',
  [STEP_IDS.javaExtract]: 'Распаковка Java',
  [STEP_IDS.filesList]: 'Получение списка файлов',
  [STEP_IDS.filesDownload]: 'Скачивание файлов',
  [STEP_IDS.filesCheck]: 'Файлы сервера',
  [STEP_IDS.modsList]: 'Получение списка модов',
  [STEP_IDS.modsDownload]: 'Проверка и скачивание модов',
  [STEP_IDS.modsClean]: 'Очистка лишних модов',
  [STEP_IDS.modsCheck]: 'Моды',
  [STEP_IDS.mcManifest]: 'Загрузка манифеста версий',
  [STEP_IDS.mcVersion]: 'Загрузка манифеста версии',
  [STEP_IDS.mcJar]: 'Клиент игры',
  [STEP_IDS.mcLibs]: 'Библиотеки игры',
  [STEP_IDS.mcNatives]: 'Нативные библиотеки',
  [STEP_IDS.mcAssetsIndex]: 'Загрузка индекса ресурсов',
  [STEP_IDS.mcAssets]: 'Загрузка ресурсов',
  [STEP_IDS.loader]: 'Установка мод-лоадера',
  [STEP_IDS.legacyJvm]: 'Обновление файлов JVM',
  [STEP_IDS.legacyAssets]: 'Обновление файлов ресурсов',
  [STEP_IDS.legacyClient]: 'Обновление файлов клиента',
  [STEP_IDS.launchConfig]: 'Подготовка конфигурации',
  [STEP_IDS.launchProcess]: 'Запуск процесса игры',
  [STEP_IDS.launchWindow]: 'Ожидание окна игры',
}

export interface StepPlanItem {
  key: StepId
  label: string
}

export function stepPlanItems(keys: readonly StepId[]): StepPlanItem[] {
  return keys.map((key) => ({ key, label: STEP_CATALOG[key] }))
}

const downloadStepIds: readonly StepId[] = [
  STEP_IDS.javaDownload,
  STEP_IDS.filesDownload,
  STEP_IDS.mcJar,
  STEP_IDS.mcLibs,
  STEP_IDS.mcAssets,
  STEP_IDS.mcNatives,
  STEP_IDS.loader,
  STEP_IDS.modsDownload,
  STEP_IDS.legacyJvm,
  STEP_IDS.legacyAssets,
  STEP_IDS.legacyClient,
]

const flowEntryStepIds: readonly StepId[] = [
  STEP_IDS.javaCheck,
  STEP_IDS.filesList,
  STEP_IDS.legacyJvm,
]

export const DOWNLOAD_STEP_IDS: ReadonlySet<string> = new Set(downloadStepIds)

export const FLOW_ENTRY_STEP_IDS: ReadonlySet<string> = new Set(flowEntryStepIds)

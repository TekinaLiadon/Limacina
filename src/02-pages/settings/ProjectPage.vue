<script setup lang="ts">
import { useProjectSettings } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { ProjectBuild, ProjectRun, ProjectJava, ProjectConnect, ProjectMaintenance, ProjectDanger, SettingsPageShell } from '@/03-widgets'

const coreStore = useCoreStore()

const {
  config,
  isDirty,
  isLoading,
  loadError,
  maxMemoryLimit,
  jvmArgsError,
  isSaving,
  isClearingConfig,
  isRefreshingManifests,
  isDeleting,
  canDeleteProject,
  serverConnectUrl,
  isLoadingConnectUrl,
  selectJavaFolder,
  handleSave,
  handleClearMinecraftConfig,
  handleRefreshManifests,
  handleDeleteProject,
  handleGetConnectUrl,
  handleCopyConnectUrl,
  loadConfig,
  retryLoad,
} = useProjectSettings()

const handleJavaReplaced = (): Promise<void> => loadConfig(coreStore.currentProject, true)
</script>

<template>
  <SettingsPageShell
    :is-loading="isLoading"
    :load-error="loadError"
    :is-saving="isSaving"
    :is-dirty="isDirty"
    @retry="retryLoad"
    @save="handleSave"
  >
    <ProjectBuild
      v-model:loader-version="config.loaderVersion"
      v-model:auto-join-server="config.autoJoinServer"
      :mc-version="config.mcVersion"
      :mod-loader="config.modLoader"
      :is-refreshing="isRefreshingManifests"
      :is-saving="isSaving"
      @refresh="handleRefreshManifests"
    />

    <ProjectRun
      v-model:memory-range="config.memoryRange"
      v-model:jvm-args="config.jvmArgs"
      :java-version="config.javaVersion"
      :max-memory-limit="maxMemoryLimit"
      :jvm-args-error="jvmArgsError"
    />

    <ProjectJava
      :java-path="config.javaPath"
      :mc-version="config.mcVersion"
      @browse="selectJavaFolder"
      @java-replaced="handleJavaReplaced"
    />

    <ProjectConnect
      v-if="config.online"
      :url="serverConnectUrl"
      :is-loading="isLoadingConnectUrl"
      @get="handleGetConnectUrl"
      @copy="handleCopyConnectUrl"
    />

    <ProjectMaintenance />

    <ProjectDanger
      :can-delete="canDeleteProject"
      :is-clearing="isClearingConfig"
      :is-deleting="isDeleting"
      @clear-config="handleClearMinecraftConfig"
      @delete-project="handleDeleteProject"
    />
  </SettingsPageShell>
</template>

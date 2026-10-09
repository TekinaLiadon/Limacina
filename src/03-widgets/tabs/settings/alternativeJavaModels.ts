import { useModel, type ModelRef } from 'vue'

export interface AlternativeJavaModelProps {
  selectedDistribution?: string
  replaceDefault?: boolean
  versionInput?: string
}

export const alternativeJavaModelDefaults: AlternativeJavaModelProps = {
  selectedDistribution: '',
  replaceDefault: false,
  versionInput: '',
}

export interface AlternativeJavaResolvedModelProps {
  selectedDistribution: string
  replaceDefault: boolean
  versionInput: string
}

export interface AlternativeJavaModels {
  selectedDistribution: ModelRef<string>
  replaceDefault: ModelRef<boolean>
  versionInput: ModelRef<string>
}

export function useAlternativeJavaModels(props: AlternativeJavaResolvedModelProps): AlternativeJavaModels {
  return {
    selectedDistribution: useModel(props, 'selectedDistribution'),
    replaceDefault: useModel(props, 'replaceDefault'),
    versionInput: useModel(props, 'versionInput'),
  }
}

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

export interface AlternativeJavaModels {
  selectedDistribution: ModelRef<string>
  replaceDefault: ModelRef<boolean>
  versionInput: ModelRef<string>
}

export function useAlternativeJavaModels(props: AlternativeJavaModelProps): AlternativeJavaModels {
  return {
    selectedDistribution: useModel(props, 'selectedDistribution') as ModelRef<string>,
    replaceDefault: useModel(props, 'replaceDefault') as ModelRef<boolean>,
    versionInput: useModel(props, 'versionInput') as ModelRef<string>,
  }
}

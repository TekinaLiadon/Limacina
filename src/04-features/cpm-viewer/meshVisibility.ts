export function computeMeshVisible(
  animVisible: boolean,
  layerId: number | undefined,
  activeLayerIds: readonly number[]
): boolean {
  const layerVisible = layerId === undefined || activeLayerIds.includes(layerId)
  return animVisible && layerVisible
}

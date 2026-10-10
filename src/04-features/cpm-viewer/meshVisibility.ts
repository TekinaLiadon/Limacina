export function computeMeshVisible(
  animVisible: boolean,
  layerId: number | undefined,
  activeLayerIds: ReadonlyArray<number>
): boolean {
  const layerVisible = layerId === undefined || activeLayerIds.includes(layerId)
  return animVisible && layerVisible
}

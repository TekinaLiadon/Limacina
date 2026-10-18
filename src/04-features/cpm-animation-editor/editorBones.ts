import type { CPMChild, CPMConfig, CPMElement } from '@/05-entities'
import { ROOT_PIVOTS } from '../cpm-viewer/useCpmViewer'
import { resolveRootStoreId } from './editorModel'

const DUPLICATE_EPSILON = 0.1
const NO_HIDDEN_BONES: ReadonlySet<number> = new Set()

interface RestOrigin {
  x: number
  y: number
  z: number
}

function quantize(value: number): number {
  return Math.round(value / DUPLICATE_EPSILON) * DUPLICATE_EPSILON
}

function elementOrigin(element: CPMElement): RestOrigin {
  const isPivot = element.customPart === true || element.dup === true
  const pivot = isPivot ? undefined : ROOT_PIVOTS[element.id]
  return {
    x: (pivot?.x ?? 0) + element.pos.x,
    y: (pivot?.y ?? 0) - element.pos.y,
    z: -(pivot?.z ?? 0) - element.pos.z,
  }
}

function childOrigin(origin: RestOrigin, child: CPMChild): RestOrigin {
  return {
    x: origin.x + child.pos.x,
    y: origin.y - child.pos.y,
    z: origin.z - child.pos.z,
  }
}

function hasGeometry(child: CPMChild): boolean {
  return child.size.x > 0 || child.size.y > 0 || child.size.z > 0
}

function signatureOf(child: CPMChild, origin: RestOrigin): string {
  return [
    childName(child),
    quantize(origin.x + child.offset.x + child.size.x * child.scale.x / 2),
    quantize(origin.y - child.offset.y - child.size.y * child.scale.y / 2),
    quantize(origin.z - child.offset.z - child.size.z * child.scale.z / 2),
    quantize(child.size.x), quantize(child.size.y), quantize(child.size.z),
    quantize(child.scale.x), quantize(child.scale.y), quantize(child.scale.z),
    quantize(child.rscale?.x ?? 1), quantize(child.rscale?.y ?? 1), quantize(child.rscale?.z ?? 1),
  ].join('|')
}

export function findDuplicateBoneIds(config: CPMConfig): ReadonlySet<number> {
  const duplicates = new Set<number>()
  const firstRootBySignature = new Map<string, number>()

  const walk = (children: CPMChild[] | undefined, origin: RestOrigin, rootIndex: number): void => {
    for (const child of children ?? []) {
      const point = childOrigin(origin, child)
      if (typeof child.storeID === 'number' && child.show !== false && hasGeometry(child)) {
        const signature = signatureOf(child, point)
        const firstRoot = firstRootBySignature.get(signature)
        if (firstRoot === undefined) firstRootBySignature.set(signature, rootIndex)
        else if (firstRoot !== rootIndex) duplicates.add(child.storeID)
      }
      walk(child.children, point, rootIndex)
    }
  }

  ;(config.elements ?? []).forEach((element, rootIndex): void => {
    if (element.showInEditor === false) return
    walk(element.children, elementOrigin(element), rootIndex)
  })

  return duplicates
}

export interface EditorBoneTreeNode {
  storeId: number | null
  name: string
  children: EditorBoneTreeNode[]
}

export interface EditorBoneTreeRow {
  storeId: number | null
  name: string
  depth: number
}

function childName(child: CPMChild): string {
  return child.name.trim() || 'Без имени'
}

function buildChildren(
  children: CPMChild[] | undefined,
  hidden: ReadonlySet<number>,
): EditorBoneTreeNode[] {
  if (!children) return []
  return children
    .filter((child): boolean =>
      child.show !== false
      && (typeof child.storeID !== 'number' || !hidden.has(child.storeID)),
    )
    .map((child): EditorBoneTreeNode => ({
      storeId: typeof child.storeID === 'number' ? child.storeID : null,
      name: childName(child),
      children: buildChildren(child.children, hidden),
    }))
}

export function buildEditorBoneTree(
  config: CPMConfig,
  hidden: ReadonlySet<number> = NO_HIDDEN_BONES,
): EditorBoneTreeNode[] {
  return (config.elements ?? [])
    .filter((element): boolean => {
      if (element.showInEditor === false) return false
      const storeId = resolveRootStoreId(element)
      return storeId === null || !hidden.has(storeId)
    })
    .map((element): EditorBoneTreeNode => ({
      storeId: resolveRootStoreId(element),
      name: element.name.trim() || element.id,
      children: buildChildren(element.children, hidden),
    }))
}

function appendRow(
  row: EditorBoneTreeNode,
  depth: number,
  rows: EditorBoneTreeRow[],
): void {
  rows.push({ storeId: row.storeId, name: row.name, depth })
  row.children.forEach((child) => appendRow(child, depth + 1, rows))
}

export function flattenEditorBoneTree(nodes: EditorBoneTreeNode[]): EditorBoneTreeRow[] {
  const rows: EditorBoneTreeRow[] = []
  nodes.forEach((node) => appendRow(node, 0, rows))
  return rows
}

export function firstAnimatableBoneId(nodes: EditorBoneTreeNode[]): number | null {
  for (const node of nodes) {
    if (node.storeId !== null) return node.storeId
    const nested = firstAnimatableBoneId(node.children)
    if (nested !== null) return nested
  }
  return null
}

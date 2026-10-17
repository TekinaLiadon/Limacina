import type { CPMChild, CPMConfig } from '@/05-entities'
import { resolveRootStoreId } from './editorModel'

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

function buildChildren(children: CPMChild[] | undefined): EditorBoneTreeNode[] {
  if (!children) return []
  return children.map((child): EditorBoneTreeNode => ({
    storeId: typeof child.storeID === 'number' ? child.storeID : null,
    name: childName(child),
    children: buildChildren(child.children),
  }))
}

export function buildEditorBoneTree(config: CPMConfig): EditorBoneTreeNode[] {
  return (config.elements ?? []).map((element): EditorBoneTreeNode => ({
    storeId: resolveRootStoreId(element),
    name: element.name.trim() || element.id,
    children: buildChildren(element.children),
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

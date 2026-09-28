import { describe, expect, it } from 'vitest'
import { DOWNLOAD_STEP_IDS, FLOW_ENTRY_STEP_IDS, STEP_IDS } from './stepIds'

const allStepIds = new Set<string>(Object.values(STEP_IDS))

describe('STEP_IDS', () => {
  it('keeps ids unique', () => {
    expect(allStepIds.size).toBe(Object.values(STEP_IDS).length)
  })

  it('uses dotted lowercase literals', () => {
    for (const id of allStepIds) {
      expect(id).toMatch(/^[a-z]+(\.[a-z]+)*$/)
    }
  })
})

describe('DOWNLOAD_STEP_IDS', () => {
  it('contains only registered step ids', () => {
    for (const id of DOWNLOAD_STEP_IDS) {
      expect(allStepIds.has(id)).toBe(true)
    }
  })

  it('contains exactly the download-heavy steps', () => {
    expect([...DOWNLOAD_STEP_IDS].sort()).toEqual(
      [
        STEP_IDS.javaDownload,
        STEP_IDS.filesDownload,
        STEP_IDS.mcJar,
        STEP_IDS.mcLibs,
        STEP_IDS.mcAssets,
        STEP_IDS.mcNatives,
        STEP_IDS.loader,
        STEP_IDS.modsDownload,
      ].sort(),
    )
  })
})

describe('FLOW_ENTRY_STEP_IDS', () => {
  it('contains only registered step ids', () => {
    for (const id of FLOW_ENTRY_STEP_IDS) {
      expect(allStepIds.has(id)).toBe(true)
    }
  })

  it('contains exactly the flow entry steps', () => {
    expect([...FLOW_ENTRY_STEP_IDS].sort()).toEqual([STEP_IDS.filesList, STEP_IDS.javaCheck].sort())
  })

  it('does not overlap the download steps', () => {
    for (const id of FLOW_ENTRY_STEP_IDS) {
      expect(DOWNLOAD_STEP_IDS.has(id)).toBe(false)
    }
  })
})

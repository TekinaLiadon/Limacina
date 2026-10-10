import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Dropdown } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities'
import AlternativeJavaPopup from '../AlternativeJavaPopup.vue'

const makeDistributions = (names: string[]): JavaDistribution[] =>
  names.map((name) => ({ name, apiParameter: `api-${name}` }))

const mountPopup = (distributions: JavaDistribution[]) =>
  mount(AlternativeJavaPopup, {
    props: {
      visible: true,
      distributions,
      isDownloading: false,
      isDistributionsLoading: false,
      distributionsError: '',
      versionError: '',
    },
  })

describe('AlternativeJavaPopup', () => {
  it('maps distributions to dropdown options and follows prop updates', async () => {
    const wrapper = mountPopup(makeDistributions(['Adoptium', 'Azul']))

    const options = (): unknown => wrapper.getComponent(Dropdown).props('options')
    expect(options()).toEqual([
      { title: 'Adoptium', value: 'Adoptium' },
      { title: 'Azul', value: 'Azul' },
    ])

    await wrapper.setProps({ distributions: makeDistributions(['BellSoft']) })
    expect(options()).toEqual([{ title: 'BellSoft', value: 'BellSoft' }])

    wrapper.unmount()
  })
})

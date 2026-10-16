import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ProjectMaintenance from '../ProjectMaintenance.vue'
import IntegrityCheck from '../../IntegrityCheck.vue'

const handleCheck = vi.fn().mockResolvedValue(undefined)
const closeResult = vi.fn()
const errorMessage = ref('')

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useIntegrityCheck: () => ({
      steps: ref([]),
      progress: ref(0),
      isChecking: ref(false),
      isCheckingNow: ref(false),
      isPopupHidden: ref(false),
      report: ref(null),
      errorMessage,
      hasErrors: ref(false),
      isClean: ref(false),
      resultText: ref(''),
      handleCheck,
      closeResult,
    }),
  }
})

const mountMaintenance = () => mount(ProjectMaintenance)

beforeEach((): void => {
  handleCheck.mockClear()
  errorMessage.value = ''
})

describe('ProjectMaintenance', () => {
  it('renders the integrity check inside its own section', () => {
    const wrapper = mountMaintenance()

    expect(wrapper.find('.settings-section__title').text()).toBe('Обслуживание')
    expect(wrapper.findComponent(IntegrityCheck).exists()).toBe(true)
  })

  it('starts the check from the integrity widget', async () => {
    const wrapper = mountMaintenance()

    await wrapper.find('.integrity-check__btn').trigger('click')

    expect(handleCheck).toHaveBeenCalledTimes(1)
  })

  it('passes the check error down to the widget', () => {
    errorMessage.value = 'Не удалось проверить файлы'

    expect(mountMaintenance().findComponent(IntegrityCheck).props('errorMessage')).toBe('Не удалось проверить файлы')
  })
})

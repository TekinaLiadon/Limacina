import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Input from '../Input.vue'

const scrollIntoViewCalls: Element[] = []
const originalScrollIntoView = Element.prototype.scrollIntoView

beforeAll((): void => {
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element): void {
    scrollIntoViewCalls.push(this)
  }
})

afterAll((): void => {
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.restoreAllMocks()
})

const mountInput = (modelValue = '') =>
  mount(Input, {
    props: { modelValue, options: { list: ['alpha', 'alphabet', 'beta'] } },
  })

describe('Input', () => {
  it('exposes aria-controls only while the listbox is rendered', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    expect(input.attributes('aria-controls')).toBeUndefined()

    await input.trigger('focus')
    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    expect(input.attributes('aria-controls')).toBe(listbox.attributes('id'))

    await input.trigger('focusout')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(input.attributes('aria-controls')).toBeUndefined()
  })

  it('omits aria-controls when the filtered list is empty', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 'zzz', options: { list: ['alpha'] } },
    })
    const input = wrapper.find('input')
    await input.trigger('focus')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(input.attributes('aria-controls')).toBeUndefined()
  })

  it('opens the filtered dropdown on focus', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').trigger('focus')

    expect(wrapper.findAll('.input__dropdown-item')).toHaveLength(3)
  })

  it('resets the active suggest when the filtered list changes', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    const staleItems = wrapper.findAll('.input__dropdown-item')
    const [, , third] = staleItems
    expect(third).toBeDefined()
    await third?.trigger('mousemove')
    expect(third?.classes()).toContain('input__dropdown-item--active')

    await wrapper.setProps({ modelValue: 'al' })

    const filtered = wrapper.findAll('.input__dropdown-item')
    expect(filtered).toHaveLength(2)
    expect(filtered[0]?.classes()).toContain('input__dropdown-item--active')
    expect(filtered[1]?.classes()).not.toContain('input__dropdown-item--active')
    expect(input.attributes('aria-activedescendant')).toMatch(/-opt-0$/)
  })

  it('selects the first filtered suggest on Enter after typing', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    await input.setValue('al')
    await wrapper.setProps({ modelValue: 'al' })
    await input.trigger('keydown', { key: 'Enter' })

    const emissions = wrapper.emitted('update:modelValue')
    const lastEmission = emissions?.[emissions.length - 1]
    expect(lastEmission).toEqual(['alpha'])
  })

  it('moves the active suggest with arrows and wraps at the ends', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    await input.trigger('keydown', { key: 'ArrowDown' })
    let items = wrapper.findAll('.input__dropdown-item')
    expect(items[1]?.classes()).toContain('input__dropdown-item--active')

    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'ArrowUp' })
    items = wrapper.findAll('.input__dropdown-item')
    expect(items[2]?.classes()).toContain('input__dropdown-item--active')
    expect(input.attributes('aria-activedescendant')).toMatch(/-opt-2$/)
  })

  it('selects the active suggest on Enter after arrow navigation', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    const emissions = wrapper.emitted('update:modelValue')
    const lastEmission = emissions?.[emissions.length - 1]
    expect(lastEmission).toEqual(['beta'])
  })

  it('prevents the default action for a handled key', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    input.element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('scrolls the active suggest into view on arrow navigation', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')
    await nextTick()
    scrollIntoViewCalls.length = 0

    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()

    const items = wrapper.findAll('.input__dropdown-item')
    expect(scrollIntoViewCalls).toEqual([items[1]?.element])
  })
})

describe('Input numeric mode', () => {
  it('returns the typed number for a numeric input', async () => {
    let limit: number | null = null
    const wrapper = mount(Input, { props: { modelValue: limit, options: { type: 'number' } } })
    const input = wrapper.find('input')
    expect(input.attributes('type')).toBe('number')

    await input.setValue('256')

    const emissions = wrapper.emitted('update:modelValue')
    const lastEmission = emissions?.[emissions.length - 1]
    expect(lastEmission).toEqual([256])

    wrapper.unmount()
  })

  it('returns null for a cleared numeric input', async () => {
    let limit: number | null = 256
    const wrapper = mount(Input, { props: { modelValue: limit, options: { type: 'number' } } })

    await wrapper.find('input').setValue('')

    const emissions = wrapper.emitted('update:modelValue')
    const lastEmission = emissions?.[emissions.length - 1]
    expect(lastEmission).toEqual([null])

    wrapper.unmount()
  })

  it('steps the value with the custom arrows', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 10, options: { type: 'number' } },
      attrs: { min: 1, max: 20, step: 2 },
    })

    await wrapper.find('[aria-label="Увеличить значение"]').trigger('click')
    let emissions = wrapper.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([12])

    await wrapper.find('[aria-label="Уменьшить значение"]').trigger('click')
    emissions = wrapper.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([8])

    wrapper.unmount()
  })

  it('clamps arrow stepping at the numeric bounds', async () => {
    const atMin = mount(Input, {
      props: { modelValue: 1, options: { type: 'number' } },
      attrs: { min: 1 },
    })
    await atMin.find('[aria-label="Уменьшить значение"]').trigger('click')
    let emissions = atMin.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([1])
    atMin.unmount()

    const atMax = mount(Input, {
      props: { modelValue: 20, options: { type: 'number' } },
      attrs: { max: 20 },
    })
    await atMax.find('[aria-label="Увеличить значение"]').trigger('click')
    emissions = atMax.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([20])
    atMax.unmount()
  })

  it('renders the stepper only for numeric inputs', () => {
    const numeric = mount(Input, { props: { modelValue: 5, options: { type: 'number' } } })
    expect(numeric.findAll('.input__step')).toHaveLength(2)
    numeric.unmount()

    const text = mountInput()
    expect(text.findAll('.input__step')).toHaveLength(0)
    text.unmount()
  })

  it('starts from the minimum when stepping an empty bounded field', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: null, options: { type: 'number' } },
      attrs: { min: 1 },
    })

    await wrapper.find('[aria-label="Увеличить значение"]').trigger('click')
    const emissions = wrapper.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([1])

    wrapper.unmount()
  })

  it('emits change with the committed numeric value', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 10, options: { type: 'number' } },
    })

    await wrapper.find('input').setValue('12')
    const emissions = wrapper.emitted('change')
    expect(emissions?.[emissions.length - 1]).toEqual([12])

    wrapper.unmount()
  })

  it('emits null as change when the numeric field is cleared', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 10, options: { type: 'number' } },
    })

    await wrapper.find('input').setValue('')
    const emissions = wrapper.emitted('change')
    expect(emissions?.[emissions.length - 1]).toEqual([null])

    wrapper.unmount()
  })

  it('steps from an uncommitted typed value', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 5, options: { type: 'number' } },
    })
    const element = wrapper.find('input').element as HTMLInputElement
    element.value = '7'

    await wrapper.find('[aria-label="Увеличить значение"]').trigger('click')
    const emissions = wrapper.emitted('update:modelValue')
    expect(emissions?.[emissions.length - 1]).toEqual([8])

    wrapper.unmount()
  })
})

describe('Input combobox semantics', () => {
  it('omits the combobox role and popup attributes without an options list', () => {
    const wrapper = mount(Input, { props: { modelValue: '' } })

    const input = wrapper.find('input')
    expect(input.attributes('role')).toBeUndefined()
    expect(input.attributes('aria-haspopup')).toBeUndefined()
    expect(input.attributes('aria-expanded')).toBeUndefined()

    wrapper.unmount()
  })

  it('announces combobox semantics when a list is configured', () => {
    const wrapper = mountInput()

    const input = wrapper.find('input')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-haspopup')).toBe('listbox')
    expect(input.attributes('aria-expanded')).toBe('false')

    wrapper.unmount()
  })

  it('names the listbox with the label, the placeholder, or a fallback', async () => {
    const labeled = mount(Input, {
      props: { modelValue: '', options: { list: ['alpha'], label: 'Ник' } },
    })
    await labeled.find('input').trigger('focus')
    expect(labeled.find('[role="listbox"]').attributes('aria-label')).toBe('Ник')
    labeled.unmount()

    const hinted = mount(Input, {
      props: { modelValue: '', options: { list: ['alpha'], placeholder: 'Введите ник' } },
    })
    await hinted.find('input').trigger('focus')
    expect(hinted.find('[role="listbox"]').attributes('aria-label')).toBe('Введите ник')
    hinted.unmount()

    const bare = mountInput()
    await bare.find('input').trigger('focus')
    expect(bare.find('[role="listbox"]').attributes('aria-label')).toBe('Варианты')
    bare.unmount()
  })
})

describe('Input near the bottom edge', () => {
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

  beforeAll((): void => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      (): DOMRect =>
        ({
          top: 700,
          bottom: 780,
          left: 0,
          right: 300,
          width: 300,
          height: 80,
          x: 0,
          y: 700,
          toJSON: (): DOMRect => ({}) as DOMRect,
        }) as DOMRect,
    )
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (): CSSStyleDeclaration =>
        ({
          paddingTop: '4px',
          paddingBottom: '6px',
          rowGap: '2px',
        }) as CSSStyleDeclaration,
    )
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: (): number => 40 })
  })

  afterAll((): void => {
    if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight)
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  })

  it('flips the dropdown above and binds the measured max-height', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')
    await nextTick()

    const dropdown = wrapper.find('.input__dropdown')
    expect(dropdown.classes()).toContain('input__dropdown--up')
    expect(dropdown.attributes('style')).toContain('max-height: 134px')
  })
})

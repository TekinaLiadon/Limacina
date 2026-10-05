import { describe, expect, it } from 'vitest'
import { getCommandError, getErrorMessage } from '../index'

describe('getCommandError', () => {
  it('passes through command error payloads', () => {
    expect(getCommandError({ code: 'auth_failed', message: 'Неверный пароль' })).toEqual({
      code: 'auth_failed',
      message: 'Неверный пароль',
    })
  })

  it('ignores payloads with non-string fields', () => {
    expect(getCommandError({ code: 42, message: 'x' })).toEqual({
      code: 'internal',
      message: '[object Object]',
    })
  })

  it('wraps plain strings as internal errors', () => {
    expect(getCommandError('Сбой')).toEqual({ code: 'internal', message: 'Сбой' })
  })

  it('wraps Error instances as internal errors', () => {
    expect(getCommandError(new Error('timeout'))).toEqual({ code: 'internal', message: 'timeout' })
  })

  it('stringifies unknown values', () => {
    expect(getCommandError(404)).toEqual({ code: 'internal', message: '404' })
    expect(getCommandError(null)).toEqual({ code: 'internal', message: 'null' })
    expect(getCommandError(undefined)).toEqual({ code: 'internal', message: 'undefined' })
  })

  it('ignores payloads missing the message field', () => {
    expect(getCommandError({ code: 'x' })).toEqual({ code: 'internal', message: '[object Object]' })
  })
})

describe('getErrorMessage', () => {
  it('returns the message of a command error', () => {
    expect(getErrorMessage({ code: 'x', message: 'msg' })).toBe('msg')
  })

  it('returns the text of a plain string error', () => {
    expect(getErrorMessage('Сбой')).toBe('Сбой')
  })

  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('timeout'))).toBe('timeout')
  })
})

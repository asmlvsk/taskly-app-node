import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

const input: TodoInput = {
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  due_date: null,
  completed: false,
}

describe('validateTodo', () => {
  it('accepts a valid task with trimmed limits and a real date', () => {
    expect(
      validateTodo({
        ...input,
        title: ` ${'a'.repeat(120)} `,
        description: 'd'.repeat(2000),
        due_date: '2028-02-29',
      }),
    ).toEqual({})
  })

  it.each([
    ['a blank title', { title: '   ' }, { title: 'Enter a task title.' }],
    [
      'a title over 120 characters',
      { title: 'a'.repeat(121) },
      { title: 'The title must be at most 120 characters.' },
    ],
    [
      'a description over 2000 characters',
      { description: 'd'.repeat(2001) },
      { description: 'The description must be at most 2000 characters.' },
    ],
    [
      'a non-ISO date',
      { due_date: '13/10/2026' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'an unparseable date',
      { due_date: '2026-13-45' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'an impossible calendar date',
      { due_date: '2026-02-30' },
      { due_date: 'Enter a valid date.' },
    ],
  ])('rejects %s', (_, change, errors) => {
    expect(validateTodo({ ...input, ...change })).toEqual(errors)
  })
})

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('keeps only completed tasks for the completed filter', () => {
    const done = { ...base, id: 2, completed: true }
    const visible = selectTodos([base, done], 'completed', '', 'newest')
    expect(visible).toEqual([done])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('breaks priority ties by the newest id', () => {
    const low: Todo = { ...base, id: 3, priority: 'low' }
    const other = { ...base, id: 2 }
    const visible = selectTodos([low, base, other], 'all', '', 'priority')
    expect(visible).toEqual([other, base, low])
  })

  it('sorts by due date with undated tasks last and ties by id', () => {
    const later = { ...base, id: 2, due_date: '2026-10-20' }
    const soon = { ...base, id: 3, due_date: '2026-10-14' }
    const sameDay = { ...base, id: 4, due_date: '2026-10-14' }
    const undated = { ...base, id: 5 }
    const todos = [base, later, undated, soon, sameDay]
    const visible = selectTodos(todos, 'all', '', 'due')
    expect(visible).toEqual([sameDay, soon, later, undated, base])
  })

  it('sorts newest first by creation time, then by id', () => {
    const older = { ...base, id: 5, created_at: '2026-09-01T12:00:00Z' }
    const twin = { ...base, id: 2 }
    const visible = selectTodos([older, base, twin], 'all', '', 'newest')
    expect(visible).toEqual([twin, base, older])
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it.each([
    ['an active task due yesterday', { due_date: '2026-10-12' }, true],
    ['an active task due today', { due_date: '2026-10-13' }, false],
    [
      'a completed task due yesterday',
      { due_date: '2026-10-12', completed: true },
      false,
    ],
    ['a task without a due date', { due_date: null }, false],
  ])('returns the right value for %s', (_, change, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 13, 9, 30))
    expect(isOverdue({ ...base, ...change })).toBe(expected)
  })
})

it('formats a due date as day, short month and year', () => {
  expect(formatDate('2026-10-13')).toBe('13 Oct 2026')
})

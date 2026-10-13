import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const done: Todo = {
  ...todoFixture,
  id: 8,
  title: 'Write report',
  completed: true,
  priority: 'high',
}
const todos = [todoFixture, done]

it('shows every task, newest first, by default', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, todoFixture])
})

it('recomputes the visible tasks when filter, search and sort change', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  act(() => result.current.setFilter('active'))
  expect(result.current.visible).toEqual([todoFixture])
  act(() => {
    result.current.setFilter('all')
    result.current.setSearch('REPORT')
  })
  expect(result.current.visible).toEqual([done])
  act(() => {
    result.current.setSearch('')
    result.current.setSort('priority')
  })
  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([done, todoFixture])
})

it('follows a new task list passed by the caller', () => {
  const { result, rerender } = renderHook(
    ({ list }: { list: Todo[] }) => useTodoFilters(list),
    { initialProps: { list: [todoFixture] } },
  )
  rerender({ list: [] })
  expect(result.current.visible).toEqual([])
})

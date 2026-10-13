import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { update: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('replaces only the updated task in the cached list', async () => {
  const saved = { ...todoFixture, completed: true }
  const other = { ...todoFixture, id: 8 }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [other, todoFixture])
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({ id: 7, input: { completed: true } }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([other, saved])
})

it('does not create a list when nothing is cached', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync({ id: 7, input: {} }))
  expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
})

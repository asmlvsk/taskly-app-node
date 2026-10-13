import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { remove: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('removes the deleted task from the cached list', async () => {
  const other = { ...todoFixture, id: 8 }
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [other, todoFixture])
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(7))
  expect(todosApi.remove).toHaveBeenCalledWith(7)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([other])
})

it('keeps the task in the cache when deletion fails', async () => {
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Task not found.'))
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [todoFixture])
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync(7)).rejects.toThrow('Task not found.'),
  )
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

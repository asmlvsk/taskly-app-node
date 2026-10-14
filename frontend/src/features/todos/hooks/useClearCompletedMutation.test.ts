import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('removes completed tasks from the cached list', async () => {
  const active = { ...todoFixture, id: 8, completed: false }
  const done = { ...todoFixture, id: 9, completed: true }
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [active, done])
  const { result } = renderHook(() => useClearCompletedMutation(), { wrapper })
  await expect(act(() => result.current.mutateAsync())).resolves.toEqual({
    deleted: 1,
  })
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([active])
})

it('leaves the cache empty when the list was never loaded', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useClearCompletedMutation(), { wrapper })
  await act(() => result.current.mutateAsync())
  expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the cached list when clearing fails', async () => {
  const done = { ...todoFixture, completed: true }
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(new Error('Failed.'))
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [done])
  const { result } = renderHook(() => useClearCompletedMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync()).rejects.toThrow('Failed.'),
  )
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([done])
})

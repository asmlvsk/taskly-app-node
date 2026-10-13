import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const input = {
  title: 'New task',
  description: '',
  priority: 'high' as const,
  due_date: null,
  completed: false,
}

it('prepends the saved task and replaces a stale copy with the same id', async () => {
  const saved = { ...todoFixture, id: 8, title: 'New task' }
  const older = { ...todoFixture, id: 6 }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { queryClient, wrapper } = createQueryWrapper()
  const stale = { ...saved, title: 'Stale' }
  queryClient.setQueryData(todoKeys.list, [stale, older])
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(input))
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved, older])
})

it('starts the list from the saved task when nothing is cached', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(input))
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('leaves the cache untouched when creation fails', async () => {
  vi.mocked(todosApi.create).mockRejectedValue(new Error('Server down'))
  const { queryClient, wrapper } = createQueryWrapper()
  queryClient.setQueryData(todoKeys.list, [todoFixture])
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync(input)).rejects.toThrow('Server down'),
  )
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

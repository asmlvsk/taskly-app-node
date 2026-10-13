import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('loads the task list with an abort signal and caches it', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('exposes the request error when loading fails', async () => {
  const error = new Error('Cannot connect to the server. Please try again.')
  vi.mocked(todosApi.list).mockRejectedValue(error)
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error).toBe(error)
})

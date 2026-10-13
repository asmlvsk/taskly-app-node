import { renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function startMutation(
  queryClient: ReturnType<typeof createQueryWrapper>['queryClient'],
  mutationKey: readonly string[],
) {
  let finish = () => {}
  const done = new Promise<void>((resolve) => (finish = resolve))
  const mutation = queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey, mutationFn: () => done })
  const running = mutation.execute(undefined)
  return { finish, running }
}

it('is not busy when no task mutation is running', () => {
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  expect(result.current).toBe(false)
})

it('is busy while a task mutation is pending', async () => {
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  const { finish, running } = startMutation(queryClient, todoKeys.delete)
  await waitFor(() => expect(result.current).toBe(true))
  finish()
  await running
  await waitFor(() => expect(result.current).toBe(false))
})

it('ignores mutations outside the todos key', async () => {
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  const { finish, running } = startMutation(queryClient, ['profile'])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(result.current).toBe(false)
  finish()
  await running
})

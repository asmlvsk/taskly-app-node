import { useMutation, useQueryClient } from '@tanstack/react-query'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'

export function useClearCompletedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: todoKeys.clearCompleted,
    mutationFn: () => todosApi.clearCompleted(),
    onSuccess: async () => {
      // Stop an older refetch from resurrecting the deleted tasks.
      await queryClient.cancelQueries({ queryKey: todoKeys.list })
      queryClient.setQueryData<Todo[]>(todoKeys.list, (current) =>
        current?.filter((todo) => !todo.completed),
      )
    },
  })
}

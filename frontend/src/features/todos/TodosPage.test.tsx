import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { useClearCompletedMutation } from './hooks/useClearCompletedMutation'
import type { Todo } from './types'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    completedCount,
    onClearCompleted,
  }: {
    completedCount: number
    onClearCompleted: () => void
  }) => (
    <div>
      <h1>Tasks</h1>
      <p>Completed: {completedCount}</p>
      <button onClick={onClearCompleted}>Clear completed</button>
    </div>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: ({
    todos,
    onCreate,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todos: Todo[]
    onCreate: () => void
    onToggle: (todo: Todo) => void
    onEdit: (todo: Todo) => void
    onDelete: (todo: Todo) => void
  }) => (
    <div>
      <p>Task list</p>
      <button onClick={onCreate}>Create task</button>
      {todos.map((todo) => (
        <div key={todo.id}>
          <button onClick={() => onToggle(todo)}>Toggle {todo.title}</button>
          <button onClick={() => onEdit(todo)}>Edit {todo.title}</button>
          <button onClick={() => onDelete(todo)}>Delete {todo.title}</button>
        </div>
      ))}
    </div>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: ({
    todo,
    onClose,
    onSaved,
  }: {
    todo: Todo | 'new'
    onClose: () => void
    onSaved: (message: string) => void
  }) => (
    <div
      role="dialog"
      aria-label={todo === 'new' ? 'New task' : `Edit ${todo.title}`}
    >
      <button onClick={onClose}>Close editor</button>
      <button onClick={() => onSaved('Changes saved.')}>Save editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: ({
    todo,
    onClose,
    onDeleted,
  }: {
    todo: Todo
    onClose: () => void
    onDeleted: () => void
  }) => (
    <div role="dialog" aria-label={`Delete ${todo.title}`}>
      <button onClick={onClose}>Keep task</button>
      <button onClick={onDeleted}>Confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

function mockPage({
  todos = [todoFixture],
  mutateAsync = vi.fn(),
  mutationError = null,
  busy = false,
  clearMutateAsync = vi.fn(),
  clearError = null,
}: {
  todos?: Todo[]
  mutateAsync?: ReturnType<typeof vi.fn>
  mutationError?: Error | null
  busy?: boolean
  clearMutateAsync?: ReturnType<typeof vi.fn>
  clearError?: Error | null
} = {}) {
  const notify = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: todos,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset: vi.fn(),
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    error: clearError,
    reset: vi.fn(),
    mutateAsync: clearMutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: todos,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  return { notify }
}

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it.each([
  {
    todo: todoFixture,
    saved: { ...todoFixture, completed: true },
    notice: 'Another task complete. Well done!',
  },
  {
    todo: { ...todoFixture, completed: true },
    saved: todoFixture,
    notice: 'Task marked as active.',
  },
])('announces "$notice" after a toggle', async ({ todo, saved, notice }) => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockResolvedValue(saved)
  const { notify } = mockPage({ todos: [todo], mutateAsync })
  render(<TodosPage />)
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: `Toggle ${todo.title}` }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith(notice))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: todo.id,
    input: { completed: !todo.completed },
  })
})

it('shows a failed toggle in the page alert without a success notice', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Update failed.'))
  const { notify } = mockPage({
    mutateAsync,
    mutationError: new Error('Update failed.'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent('Update failed.')
  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
})

it('ignores toggles and disables retry while another change is running', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  mockPage({
    mutateAsync,
    mutationError: new Error('Update failed.'),
    busy: true,
  })
  render(<TodosPage />)
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )
  expect(mutateAsync).not.toHaveBeenCalled()
})

it.each([
  { deleted: 1, notice: 'Cleared 1 completed task.' },
  { deleted: 2, notice: 'Cleared 2 completed tasks.' },
])('announces "$notice" after clearing completed tasks', async (result) => {
  const user = userEvent.setup()
  const clearMutateAsync = vi
    .fn()
    .mockResolvedValue({ deleted: result.deleted })
  const { notify } = mockPage({
    todos: [{ ...todoFixture, completed: true }],
    clearMutateAsync,
  })
  render(<TodosPage />)
  expect(screen.getByText('Completed: 1')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith(result.notice))
  expect(clearMutateAsync).toHaveBeenCalledTimes(1)
})

it('does not clear when no task is completed or another change is running', async () => {
  const user = userEvent.setup()
  const clearMutateAsync = vi.fn()
  mockPage({ clearMutateAsync })
  const { unmount } = render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  expect(clearMutateAsync).not.toHaveBeenCalled()
  unmount()
  mockPage({
    todos: [{ ...todoFixture, completed: true }],
    clearMutateAsync,
    busy: true,
  })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  expect(clearMutateAsync).not.toHaveBeenCalled()
})

it('shows a failed clear in the page alert without a notice', async () => {
  const user = userEvent.setup()
  const clearMutateAsync = vi.fn().mockRejectedValue(new Error('Clear failed.'))
  const { notify } = mockPage({
    todos: [{ ...todoFixture, completed: true }],
    clearMutateAsync,
    clearError: new Error('Clear failed.'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent('Clear failed.')
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  await waitFor(() => expect(clearMutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
})

it('opens the editor for a new task and closes it with a notice after saving', async () => {
  const user = userEvent.setup()
  const { notify } = mockPage()
  render(<TodosPage />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Create task' }))
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save editor' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Changes saved.')
})

it('opens the editor for an existing task and closes it without a notice', async () => {
  const user = userEvent.setup()
  const { notify } = mockPage()
  render(<TodosPage />)
  await user.click(
    screen.getByRole('button', { name: `Edit ${todoFixture.title}` }),
  )
  expect(
    screen.getByRole('dialog', { name: `Edit ${todoFixture.title}` }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it('confirms a deletion with a notice and allows backing out', async () => {
  const user = userEvent.setup()
  const { notify } = mockPage()
  render(<TodosPage />)
  const deleteButton = screen.getByRole('button', {
    name: `Delete ${todoFixture.title}`,
  })
  await user.click(deleteButton)
  await user.click(screen.getByRole('button', { name: 'Keep task' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
  await user.click(deleteButton)
  expect(
    screen.getByRole('dialog', { name: `Delete ${todoFixture.title}` }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})

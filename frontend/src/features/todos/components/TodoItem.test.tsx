import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('shows a completed task with its description and forwards toggle and delete', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  const todo = {
    ...todoFixture,
    completed: true,
    priority: 'high' as const,
    description: 'Slides and a live run',
  }
  render(
    <TodoItem
      todo={todo}
      busy={false}
      onEdit={vi.fn()}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.getByText('High')).toBeVisible()
  expect(screen.getByText('Slides and a live run')).toBeVisible()
  const checkbox = screen.getByRole('checkbox', {
    name: `Mark as active: ${todo.title}`,
  })
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  expect(onToggle).toHaveBeenCalledTimes(1)
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todo.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('disables every action while busy', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  const checkbox = screen.getByRole('checkbox', {
    name: `Complete: ${todoFixture.title}`,
  })
  const edit = screen.getByRole('button', {
    name: `Edit: ${todoFixture.title}`,
  })
  const remove = screen.getByRole('button', {
    name: `Delete: ${todoFixture.title}`,
  })
  for (const control of [checkbox, edit, remove]) {
    expect(control).toBeDisabled()
    await user.click(control)
  }
  expect(onToggle).not.toHaveBeenCalled()
  expect(onEdit).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

describe('due date badge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 13, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const renderItem = (todo: Todo) =>
    render(
      <TodoItem
        todo={todo}
        busy={false}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

  it('marks an active task past its due date as overdue', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-01' })
    expect(screen.getByText('1 Oct 2026 · overdue')).toBeVisible()
  })

  it('shows an upcoming due date without the overdue marker', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-13' })
    expect(screen.getByText('13 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })

  it('never marks a completed task as overdue', () => {
    renderItem({ ...todoFixture, completed: true, due_date: '2026-10-01' })
    expect(screen.getByText('1 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })
})

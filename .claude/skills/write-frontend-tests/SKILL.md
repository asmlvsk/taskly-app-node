---
name: write-frontend-tests
description: Conventions and templates for writing or updating Vitest + React Testing Library unit tests for the React frontend. Use when a test decision targets a file under frontend/src.
---

# Write frontend tests

Frontend tests are colocated next to the source as `<Name>.test.tsx` or `<name>.test.ts`, run under `jsdom` with `@testing-library/react`, `@testing-library/user-event` and `jest-dom` matchers (globals are enabled, but existing tests import `it`/`expect`/`vi` from `vitest` explicitly; do the same). Read `TodoEditor.test.tsx` and `TodosPage.test.tsx` first and copy their style.

## House style (Prettier enforced)

- No semicolons, single quotes, trailing commas, 2-space indent, 80-column wrap. Run `npm --prefix frontend exec -- prettier --check frontend/src/<path>` from the repository root; fix formatting by editing the file.
- Flat `it(...)`; `describe` only for several behaviours of one unit.
- Fixture: `import { todoFixture } from '<rel>/test/todoFixture'`, extended with spread.
- Query by role and accessible name first (`getByRole('button', { name: 'Save task' })`), then by label text, then by text. Avoid test ids except `alert` from the mocks.
- `const user = userEvent.setup()` at the top of each interactive test; `await` every user action.
- Assert both the visible outcome and the callback contract (`toHaveBeenCalledWith`).

## Mock the design system

Every component test that renders design-system components must mock the barrel so no styled-components or theme is needed:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
```

Keep the relative path correct for the file's depth. The mocks render native elements: `Alert` → `div[data-testid="alert"]`, `Input`/`Select` → `<label>` wrapping a native control, `Drawer` → `div[role="dialog"][aria-label=title]` with a `Close` button that is disabled while `busy` (so `getByRole('dialog', { name })` and `getByRole('button', { name: 'Close' })` work).

## Patterns by module

**Presentational components** (`TodoItem`, `TodoList`, `TodoEmptyState`, `TodosHeader`): render with explicit props, cover each rendering branch (completed vs active, overdue badge, empty vs "no matching", loading/failed), and that callbacks fire or are blocked when `busy`/`disabled`. Mock child components with `vi.mock('./TodoItem', () => ({ TodoItem: () => <li>Task</li> }))` when testing a container.

**Components using hooks** (`TodoEditor`, `DeleteTodoDialog`, `TodosPage`): mock each hook module and control its return value:

```tsx
vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))
vi.mocked(useDeleteTodoMutation).mockReturnValue({
  isPending: false, error: null, mutateAsync,
} as unknown as ReturnType<typeof useDeleteTodoMutation>)
```

Cover the success path (callback called with the right message), the failure path (error alert shown, callback not called), and the `busy` guard.

**TanStack Query hooks** (`useTodosQuery`, `use*Mutation`, `useTodosBusy`): do not mock react-query. Use `renderHook` with a wrapper that provides a fresh `QueryClient` (`retry: false`), mock `../api/todos` with `vi.mock`, and assert cache updates through `queryClient.getQueryData(todoKeys.list)` after `await waitFor(() => expect(result.current.isSuccess).toBe(true))` or `await act(() => result.current.mutateAsync(...))`.

**State hooks** (`useTodoFilters`, `useNotice`): `renderHook`, change state inside `act`, and for timers use `vi.useFakeTimers()` with `vi.useRealTimers()` in `afterEach` (`act(() => vi.advanceTimersByTime(4000))`).

**HTTP client** (`lib/http.ts`): `vi.stubGlobal('fetch', vi.fn())` and `vi.unstubAllGlobals()` in `afterEach`. Build responses with `new Response(body, { status })`. Cover: success JSON, 204 → `undefined`, 422 message, `detail` from body, generic fallback, network failure message, and rethrow when `signal.aborted`.

**Pure utils** (`utils/todos.ts`): table-driven `it.each` for `validateTodo` (title empty/too long, description too long, bad date formats, impossible dates like `2026-02-30`), `selectTodos` for each filter and sort with tie-breaking by id, `isOverdue` with `vi.setSystemTime`, `formatDate` output for a fixed date.

**Providers** (`AppProviders`): render a child, assert it is in the document, and that a custom `client` prop is used (`useQueryClient` inside a probe component).

## Do not

- Do not edit anything under `frontend/src` that is not a test file, `src/test/**`, or `design-system/mocks.tsx` (only when a new design-system component needs a mock).
- Do not add dependencies or change `vite.config.ts`.
- Do not test `design-system/**` components; they are covered by Storybook and excluded from coverage.
- Do not use `act` warnings as a signal of success; resolve them with `await waitFor` or `findBy*`.
- Do not rely on real timers for notices or on the real clock for dates.

## After writing

Run the `verify-tests` skill for the frontend (typecheck, prettier check, tests, coverage).

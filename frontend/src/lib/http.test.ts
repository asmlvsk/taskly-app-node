import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

const validationMessage =
  'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.'

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => vi.unstubAllGlobals())

it('prefixes the path, sends JSON headers and returns the body', async () => {
  const fetchMock = stubFetch(jsonResponse({ id: 7 }, 200))
  const init = { method: 'POST', headers: { 'X-Trace': '1' } }
  await expect(request('/todos', init)).resolves.toEqual({ id: 7 })
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace': '1' },
  })
})

it('resolves to undefined for 204 No Content', async () => {
  stubFetch(new Response(null, { status: 204 }))
  const result = await request('/todos/7', { method: 'DELETE' })
  expect(result).toBeUndefined()
})

it('replaces validation errors with a user-friendly message', async () => {
  stubFetch(jsonResponse({ detail: 'title: too long' }, 422))
  await expect(request('/todos')).rejects.toThrow(validationMessage)
})

it('surfaces the server detail message when present', async () => {
  stubFetch(jsonResponse({ detail: 'Task not found.' }, 404))
  await expect(request('/todos/9')).rejects.toThrow('Task not found.')
})

it.each([
  ['a non-JSON body', 'Internal error'],
  ['a non-string detail', JSON.stringify({ detail: [{ msg: 'x' }] })],
])('falls back to a generic message for %s', async (_, body) => {
  stubFetch(new Response(body, { status: 500 }))
  const failure = 'The operation failed. Please try again.'
  await expect(request('/todos')).rejects.toThrow(failure)
})

it('reports a connection problem when the network request fails', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
  vi.stubGlobal('fetch', fetchMock)
  const failure = 'Cannot connect to the server. Please try again.'
  await expect(request('/todos')).rejects.toThrow(failure)
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException('Aborted', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
  const pending = request('/todos', { signal: controller.signal })
  await expect(pending).rejects.toBe(abortError)
})

import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = { todo: { findMany: vi.fn().mockResolvedValue([record]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  return { app: createApp(database as unknown as Database), database };
}
it('mounts the health and todos routers', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(response.headers['x-powered-by']).toBeUndefined();
});
it('serves the OpenAPI specification and the docs UI', async () => {
  const { app } = setup();
  const response = await request(app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
  expect(response.body).toHaveProperty('paths');
  expect([200, 301, 302]).toContain((await request(app).get('/docs')).status);
  const docs = await request(app).get('/docs/');
  expect(docs.status).toBe(200);
  expect(docs.text).toContain('swagger-ui');
});
it('returns a JSON 404 for unknown routes', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('returns 422 for malformed JSON without calling the database', async () => {
  const { app, database } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(database.todo.create).not.toHaveBeenCalled();
});
it('returns 413 for an oversized body', async () => {
  const { app, database } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'Task', description: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
  expect(database.todo.create).not.toHaveBeenCalled();
});
it('hides unexpected errors behind a generic 500 and logs them', async () => {
  const { app, database } = setup();
  const error = new Error('Database unavailable');
  database.todo.findMany.mockRejectedValue(error);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(error);
});

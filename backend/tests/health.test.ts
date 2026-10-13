import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import type { Database } from '../src/features/todos/types.ts';

function setup(findFirst = vi.fn().mockResolvedValue(null)) {
  const app = express();
  app.use('/api', createHealthRouter({ todo: { findFirst } } as unknown as Database));
  return { app, findFirst };
}
it('reports ok after a cheap database probe', async () => {
  const { app, findFirst } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('does not report ok when the database is unreachable', async () => {
  const { app } = setup(vi.fn().mockRejectedValue(new Error('Database unavailable')));
  app.use(((error, req, res, next) => res.status(500).json({ detail: (error as Error).message })) as express.ErrorRequestHandler);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Database unavailable' });
});

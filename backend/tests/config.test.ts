import { afterEach, beforeEach, it, expect } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const variables = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];
let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  for (const name of variables) delete process.env[name];
});
afterEach(() => {
  process.env = snapshot;
});

function setParts() {
  Object.assign(process.env, { POSTGRES_USER: 'taskly', POSTGRES_PASSWORD: 'secret', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'taskly' });
}

it('prefers an explicit override over DATABASE_URL and the individual parts', () => {
  setParts();
  process.env.DATABASE_URL = 'postgresql://env:env@env:5432/env';
  expect(resolveDatabaseUrl('postgresql://a:b@override:5432/db')).toBe('postgresql://a:b@override:5432/db');
});
it('uses DATABASE_URL when no override is given', () => {
  process.env.DATABASE_URL = 'postgresql://env:env@env:5432/env';
  expect(resolveDatabaseUrl()).toBe('postgresql://env:env@env:5432/env');
});
it('rewrites the SQLAlchemy postgresql+psycopg scheme', () => {
  process.env.DATABASE_URL = 'postgresql+psycopg://u:p@host:5432/db';
  expect(resolveDatabaseUrl()).toBe('postgresql://u:p@host:5432/db');
});
it('builds the URL from individual variables', () => {
  setParts();
  expect(resolveDatabaseUrl()).toBe('postgresql://taskly:secret@db:5432/taskly');
});
it.each(variables.slice(1))('throws when %s is missing', (name) => {
  setParts();
  delete process.env[name];
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
it('treats an empty variable as missing', () => {
  setParts();
  process.env.POSTGRES_PASSWORD = '';
  expect(() => resolveDatabaseUrl()).toThrow('Missing environment variable: POSTGRES_PASSWORD');
});
it('URL-encodes special characters in user, password and database name', () => {
  setParts();
  Object.assign(process.env, { POSTGRES_USER: 'us@r', POSTGRES_PASSWORD: 'p@ss:w/rd#', POSTGRES_DB: 'my db/x' });
  const url = new URL(resolveDatabaseUrl());
  expect(decodeURIComponent(url.username)).toBe('us@r');
  expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd#');
  expect(decodeURIComponent(url.pathname.slice(1))).toBe('my db/x');
  expect(url.hostname).toBe('db');
  expect(url.port).toBe('5432');
});

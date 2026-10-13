import { it, expect, vi } from 'vitest';
import { initialize } from '../src/core/database.ts';
import type { Database } from '../src/features/todos/types.ts';

it('initializes the todos table idempotently with its constraints', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw } as unknown as Database);
  expect($executeRaw).toHaveBeenCalledOnce();
  const sql = ($executeRaw.mock.calls[0][0] as TemplateStringsArray).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain('CONSTRAINT todo_title_not_empty CHECK (length(title) >= 1)');
  expect(sql).toContain("CONSTRAINT todo_priority CHECK (priority IN ('low', 'medium', 'high'))");
});
it('propagates initialization errors', async () => {
  const $executeRaw = vi.fn().mockRejectedValue(new Error('permission denied'));
  await expect(initialize({ $executeRaw } as unknown as Database)).rejects.toThrow('permission denied');
});

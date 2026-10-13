import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

class FakeServer extends EventEmitter {
  close = vi.fn((callback: () => void) => callback());
  address = () => ({ port: 8123, address: '0.0.0.0', family: 'IPv4' });
}

let env: NodeJS.ProcessEnv;
let exitCode: typeof process.exitCode;

beforeEach(() => {
  env = { ...process.env };
  exitCode = process.exitCode;
  delete process.env.API_PORT;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'once').mockImplementation(() => process);
});
afterEach(() => {
  process.env = env;
  process.exitCode = exitCode;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function setup(listenError?: Error) {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = new FakeServer();
  const listen = vi.fn((port: number, host: string, callback: () => void) => {
    queueMicrotask(() => (listenError ? server.emit('error', listenError) : callback()));
    return server;
  });
  vi.mocked(createDatabase).mockReturnValue(database as unknown as ReturnType<typeof createDatabase>);
  vi.mocked(createApp).mockReturnValue({ listen } as unknown as ReturnType<typeof createApp>);
  return { database, server, listen };
}
function signalHandler(signal: string) {
  const call = vi.mocked(process.once).mock.calls.find(([name]) => name === signal);
  return call![1] as () => void;
}

it('connects, initializes and listens on API_PORT', async () => {
  const { database, server, listen } = setup();
  process.env.API_PORT = '9001';
  const result = await start();
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(listen).toHaveBeenCalledWith(9001, '0.0.0.0', expect.any(Function));
  expect(result).toEqual({ server, database });
  expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 8123');
  expect(database.$disconnect).not.toHaveBeenCalled();
});
it('listens on port 8000 by default and registers shutdown handlers', async () => {
  const { listen } = setup();
  await start();
  expect(listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
  expect(process.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  expect(process.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
});
it('disconnects and rethrows when connecting fails', async () => {
  const { database } = setup();
  database.$connect.mockRejectedValue(new Error('Connection refused'));
  await expect(start()).rejects.toThrow('Connection refused');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(initialize).not.toHaveBeenCalled();
  expect(createApp).not.toHaveBeenCalled();
});
it('disconnects and rethrows when the port cannot be bound', async () => {
  const { database } = setup(new Error('EADDRINUSE'));
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(process.once).not.toHaveBeenCalled();
});
it('closes the server and disconnects on SIGTERM', async () => {
  const { database, server } = setup();
  await start();
  signalHandler('SIGTERM')();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
  expect(server.close).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(exitCode);
});
it('logs and sets a failing exit code when disconnecting fails on shutdown', async () => {
  const { database } = setup();
  const error = new Error('Disconnect failed');
  database.$disconnect.mockRejectedValue(error);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await start();
  signalHandler('SIGINT')();
  await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(error));
  expect(process.exitCode).toBe(1);
});
it('forces exit after 10 seconds when the server does not close', async () => {
  const { server, database } = setup();
  await start();
  vi.useFakeTimers();
  server.close.mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  signalHandler('SIGTERM')();
  vi.advanceTimersByTime(9999);
  expect(exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(exit).toHaveBeenCalledWith(1);
  expect(database.$disconnect).not.toHaveBeenCalled();
});

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runChild, threadPort } from '../src/elk-io';

function fakeThread() {
  const emitter = new EventEmitter();
  const thread = Object.assign(emitter, {
    posted: [] as unknown[],
    postMessage(msg: unknown) {
      thread.posted.push(msg);
    },
    terminate() {
      emitter.emit('exit', 1);
    },
  });
  return thread;
}

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
  return child as unknown as ChildProcessWithoutNullStreams & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
}

describe('threadPort', () => {
  it('fails a pending request when the thread exits', () => {
    const thread = fakeThread();
    const port = threadPort(thread);
    const answers: { data: { id: number; error?: Error } }[] = [];
    port.onmessage = (a) => answers.push(a as never);
    port.postMessage({ id: 1 });
    thread.emit('exit', 1);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.data.id).toBe(1);
    expect(answers[0]!.data.error?.message).toMatch(/exit code 1/);
  });

  it('does not fail an answered request when the thread later exits', () => {
    const thread = fakeThread();
    const port = threadPort(thread);
    const answers: { data: { id: number; error?: Error } }[] = [];
    port.onmessage = (a) => answers.push(a as never);
    port.postMessage({ id: 1 });
    thread.emit('message', { id: 1 });
    thread.emit('exit', 0);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.data.error).toBeUndefined();
  });

  it('fails a pending request when the thread errors', () => {
    const thread = fakeThread();
    const port = threadPort(thread);
    const answers: { data: { id: number; error?: Error } }[] = [];
    port.onmessage = (a) => answers.push(a as never);
    port.postMessage({ id: 1 });
    thread.emit('error', new Error('out of memory'));
    expect(answers).toHaveLength(1);
    expect(answers[0]!.data.error?.message).toBe('out of memory');
  });
});

describe('runChild', () => {
  it('resolves the JSON the child prints', async () => {
    const child = fakeChild();
    const p = runChild(child, '{}');
    child.stdout.write('{"id":"root"}');
    child.emit('close', 0, null);
    await expect(p).resolves.toEqual({ id: 'root' });
  });

  it('rejects, rather than throwing outside the promise, on truncated output', async () => {
    const child = fakeChild();
    const p = runChild(child, '{}');
    child.stdout.write('{"id":');
    child.emit('close', 0, null);
    await expect(p).rejects.toThrow(/invalid JSON/);
  });

  it('rejects with the signal when the child is killed silently', async () => {
    const child = fakeChild();
    const p = runChild(child, '{}');
    child.emit('close', null, 'SIGKILL');
    await expect(p).rejects.toThrow(/killed by SIGKILL/);
  });

  it('survives EPIPE on stdin and reports the child stderr', async () => {
    const child = fakeChild();
    const p = runChild(child, '{}');
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.stderr.write('boom');
    child.emit('close', 1, null);
    await expect(p).rejects.toThrow(/boom/);
  });

  it('settles with the first failure only', async () => {
    const child = fakeChild();
    const p = runChild(child, '{}');
    child.emit('error', new Error('spawn failed'));
    child.emit('close', 1, null);
    await expect(p).rejects.toThrow('spawn failed');
  });
});

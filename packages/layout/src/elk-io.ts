import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';

/** What threadElk needs from a worker thread: enough to fake in a test. */
export interface ThreadLike extends Pick<EventEmitter, 'on'> {
  postMessage(msg: unknown): void;
  terminate(): unknown;
}

/** elkjs's worker port over a thread; a thread that dies or exits fails what it was asked instead of hanging. */
export function threadPort(thread: ThreadLike) {
  const pending = new Set<number>();
  const port = {
    onmessage: null as ((answer: { data: unknown }) => void) | null,
    postMessage(msg: { id: number }) {
      pending.add(msg.id);
      thread.postMessage(msg);
    },
    terminate: () => void thread.terminate(),
  };
  thread.on('message', (data: { id: number; error?: { message: string } }) => {
    pending.delete(data.id);
    port.onmessage?.({ data: data.error ? { ...data, error: new Error(data.error.message) } : data });
  });
  // A thread that dies (out of memory, say) answers nothing: fail what it was asked instead of hanging.
  thread.on('error', (error) => {
    for (const id of pending) port.onmessage?.({ data: { id, error } });
    pending.clear();
  });
  // An exit (terminate, process.exit, some resource limits) can come without an 'error': fail what's still waiting.
  thread.on('exit', (code: number) => {
    const error = new Error(`ELK thread stopped (exit code ${code})`);
    for (const id of pending) port.onmessage?.({ data: { id, error } });
    pending.clear();
  });
  return port;
}

/** Sends `input` to a child ELK and resolves its JSON answer; every way the child can fail rejects, once. */
export function runChild<T>(child: ChildProcessWithoutNullStreams, input: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let out = '';
    let err = '';
    let settled = false;
    const succeed = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    child.stdout.on('data', (c: Buffer) => (out += c));
    child.stderr.on('data', (c: Buffer) => (err += c));
    child.on('error', (e) => fail(e));
    // EPIPE when the child dies before reading its input: 'close' reports why.
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => {
      if (code === 0) {
        try {
          succeed(JSON.parse(out) as T);
        } catch (e) {
          fail(new Error(`ELK answered with invalid JSON: ${(e as Error).message}`));
        }
      } else {
        fail(new Error(err.trim() || (signal ? `ELK was killed by ${signal}` : `ELK exited with code ${code}`)));
      }
    });
    child.stdin.end(input);
  });
}

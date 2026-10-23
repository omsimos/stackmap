import { spawn } from 'node:child_process';

/** The command that opens a file in the default browser on `platform`, or why it can't be done safely. */
export function browserCommand(
  file: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } | { refused: string } {
  if (platform === 'darwin') return { cmd: 'open', args: [file] };
  // `start` is a cmd builtin, and its first quoted argument is the window title.
  // Quoted, cmd takes & | < > ^ ( ) literally; it still expands %VAR% inside quotes, and " would end the quoting.
  if (platform === 'win32')
    return /["%]/.test(file)
      ? { refused: 'the path has a " or % that cmd would interpret' }
      : { cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`] };
  return { cmd: 'xdg-open', args: [file] };
}

/**
 * Opens `file` in the default browser; resolves null once the opener has handed it off, or why it couldn't (no
 * opener installed, a headless machine). An opener that is still running after a moment is taken as success.
 */
export function openInBrowser(file: string): Promise<string | null> {
  const command = browserCommand(file);
  if ('refused' in command) return Promise.resolve(command.refused);
  const { cmd, args } = command;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: cmd === 'cmd' });
    const timer = setTimeout(() => resolve(null), 3000);
    const done = (why: string | null) => {
      clearTimeout(timer);
      resolve(why);
    };
    child.once('error', (e) => done((e as NodeJS.ErrnoException).code === 'ENOENT' ? `${cmd} not found` : e.message));
    child.once('exit', (code) => done(code ? `${cmd} exited with ${code}` : null));
    child.unref();
  });
}

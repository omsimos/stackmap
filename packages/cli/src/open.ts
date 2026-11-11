import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One way to open a file: `windowsPath` means the file must first be given as a Windows path (WSL), and `anyExit`
 * means the exit code says nothing about success.
 */
export type Opener = { cmd: string; args: string[]; windowsPath?: boolean; anyExit?: boolean };

/** Whether this Linux is WSL, where a stock distro has no xdg-open but Windows has a browser. */
export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/** The commands that may open a file in the default browser on `platform`, in order, or why it can't be done safely. */
export function browserCommands(
  file: string,
  platform: NodeJS.Platform = process.platform,
  wsl = platform === 'linux' && isWsl(),
): Opener[] | { refused: string } {
  if (platform === 'darwin') return [{ cmd: 'open', args: [file] }];
  // `start` is a cmd builtin, and its first quoted argument is the window title.
  // Quoted, cmd takes & | < > ^ ( ) literally; it still expands %VAR% inside quotes, and " would end the quoting.
  if (platform === 'win32')
    return /["%]/.test(file)
      ? { refused: 'the path has a " or % that cmd would interpret' }
      : [{ cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`] }];
  if (!wsl) return [{ cmd: 'xdg-open', args: [file] }];
  // explorer.exe hands the file to the Windows default browser, and exits with 1 even when it did.
  return [
    { cmd: 'xdg-open', args: [file] },
    { cmd: 'wslview', args: [file] },
    { cmd: 'explorer.exe', args: [file], windowsPath: true, anyExit: true },
  ];
}

/**
 * Opens `file` in the default browser; resolves null once an opener has handed it off, or why none could (no opener
 * installed, a headless machine). Each opener that fails hands over to the next. An opener that is still running
 * after a moment is taken as success.
 */
export async function openInBrowser(file: string): Promise<string | null> {
  const commands = browserCommands(file);
  if ('refused' in commands) return commands.refused;
  const failures: string[] = [];
  for (const opener of commands) {
    const why = await run(opener);
    if (why === null) return null;
    failures.push(why);
  }
  return failures.join('; ');
}

function run({ cmd, args, windowsPath, anyExit }: Opener): Promise<string | null> {
  if (windowsPath) {
    try {
      args = args.map((a) => execFileSync('wslpath', ['-w', resolve(a)], { encoding: 'utf8' }).trim());
    } catch {
      return Promise.resolve(`wslpath couldn't convert the path for ${cmd}`);
    }
  }
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: cmd === 'cmd' });
    const timer = setTimeout(() => done(null), 3000);
    const finish = (why: string | null) => {
      clearTimeout(timer);
      done(why);
    };
    child.once('error', (e) => finish((e as NodeJS.ErrnoException).code === 'ENOENT' ? `${cmd} not found` : e.message));
    child.once('exit', (code) => finish(code && !anyExit ? `${cmd} exited with ${code}` : null));
    child.unref();
  });
}

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One way to open a file. `orAt` finds `cmd` when it isn't on the PATH. `startFile` is a file for PowerShell to
 * start (WSL): its Windows path goes on the end of `args`, as an encoded command; `windowsFile` is one whose Windows
 * path goes there as it is. `wait` is how long, in ms, the opener gets to exit before it counts as having handed the
 * file off. `blind` marks an opener whose exit code says nothing, so that having started is all it can report.
 */
export type Opener = {
  cmd: string;
  args: string[];
  orAt?: () => string;
  startFile?: string;
  windowsFile?: string;
  wait?: number;
  blind?: true;
};

const NOT_FOUND = 'not found';
// xdg-open can turn into the browser itself and never exit, so a short wait has to count as a hand-off.
const HANDED_OFF = 3000;
// A Windows program started through WSL interop can take longer than that to load, and its exit code is the only
// sign that nothing opened.
const WINDOWS_START = 15000;

// WSL leaves the Windows directories off the PATH under `appendWindowsPath=false`, and `automount.root` moves /mnt.
const inWindows = (path: string) => (): string => {
  try {
    return wslpath('-u', `C:\\Windows\\${path}`);
  } catch {
    return `/mnt/c/Windows/${path.replaceAll('\\', '/')}`;
  }
};

const INTEROP = ['/proc/sys/fs/binfmt_misc/WSLInterop', '/proc/sys/fs/binfmt_misc/WSLInterop-late'];

/** Whether this Linux is WSL, where a stock distro has no xdg-open but Windows has a browser. */
export function isWsl(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  has: (path: string) => boolean = existsSync,
): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    // A Docker Desktop container runs on the WSL kernel too, but only WSL itself registers the Windows interop.
    return /microsoft/i.test(read('/proc/version')) && INTEROP.some(has);
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
  // The browser is on the Windows side. xdg-open comes last: with no Linux browser it can exit 0 having opened
  // nothing, which would end the chain. PowerShell, unlike explorer.exe, exits non-zero when it couldn't start the file.
  const start: Opener = {
    cmd: 'powershell.exe',
    orAt: inWindows('System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand'],
    startFile: file,
    wait: WINDOWS_START,
  };
  // wslview hands the path to PowerShell with quoting of its own, so it only gets paths PowerShell reads literally.
  const viaWslview: Opener[] = /[$`'"‘’‚‛“”„]/.test(file) ? [] : [{ cmd: 'wslview', args: [file], wait: WINDOWS_START }];
  // Where policy blocks PowerShell, explorer.exe still opens the file; it exits 1 either way.
  const explorer: Opener = { cmd: 'explorer.exe', orAt: inWindows('explorer.exe'), args: [], windowsFile: file, wait: WINDOWS_START, blind: true };
  return [...viaWslview, start, explorer, { cmd: 'xdg-open', args: [file] }];
}

export function startCommand(windowsPath: string): string {
  // PowerShell ends a single-quoted string on the curly quotes too; a doubled one is the only escape.
  return `Start-Process -FilePath '${windowsPath.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

function wslpath(to: '-w' | '-u', path: string): string {
  // stderr is dropped so that wslpath's own message doesn't land ahead of the warning.
  return execFileSync('wslpath', [to, path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * Opens `file` in the default browser; resolves null once an opener has handed it off, or why none could (no opener
 * installed, a headless machine).
 */
export async function openInBrowser(file: string): Promise<string | null> {
  const commands = browserCommands(file);
  return 'refused' in commands ? commands.refused : openWith(commands);
}

export async function openWith(
  openers: Opener[],
  windowsPath: (file: string) => string = (file) => wslpath('-w', file),
): Promise<string | null> {
  const failures: string[] = [];
  for (const opener of openers) {
    const why = await run(opener, windowsPath);
    if (why === null) return null;
    failures.push(why);
  }
  return failures.join('; ');
}

async function run(
  { cmd, args, orAt, startFile, windowsFile, wait = HANDED_OFF, blind }: Opener,
  windowsPath: (file: string) => string,
): Promise<string | null> {
  const file = startFile ?? windowsFile;
  if (file !== undefined) {
    try {
      const path = windowsPath(resolve(file));
      args = [...args, startFile === undefined ? path : Buffer.from(startCommand(path), 'utf16le').toString('base64')];
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'wslpath not found' : "wslpath couldn't convert the path";
    }
  }
  let why = await launch(cmd, args, wait, blind);
  if (why === NOT_FOUND && orAt) why = await launch(orAt(), args, wait, blind);
  return why === null ? null : `${cmd} ${why}`;
}

/** Resolves null once the command exits cleanly or is still running after `wait` ms, else what went wrong. */
function launch(cmd: string, args: string[], wait: number, blind = false): Promise<string | null> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: cmd === 'cmd' });
    const timer = setTimeout(() => done(null), wait);
    const finish = (why: string | null) => {
      clearTimeout(timer);
      done(why);
    };
    child.once('error', (e) => finish((e as NodeJS.ErrnoException).code === 'ENOENT' ? NOT_FOUND : `failed (${e.message})`));
    child.once('exit', (code, signal) => finish(blind ? null : code ? `exited with ${code}` : signal ? `was killed by ${signal}` : null));
    child.unref();
  });
}

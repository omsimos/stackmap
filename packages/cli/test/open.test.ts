import { describe, expect, it } from 'vitest';
import { browserCommands, isWsl, openWith, startCommand } from '../src/open';

const NODE = process.execPath;
const MISSING = 'stackmap-no-such-opener';
const exits = (code: number) => ({ cmd: NODE, args: ['-e', `process.exit(${code})`] });

describe('browserCommands', () => {
  it('uses the native opener on darwin and linux', () => {
    expect(browserCommands('/tmp/a b.html', 'darwin')).toEqual([{ cmd: 'open', args: ['/tmp/a b.html'] }]);
    expect(browserCommands('/tmp/a.html', 'linux', false)).toEqual([{ cmd: 'xdg-open', args: ['/tmp/a.html'] }]);
  });

  it('tries the Windows side first on WSL, and xdg-open last', () => {
    const commands = browserCommands('/tmp/a.html', 'linux', true);
    expect(Array.isArray(commands) && commands.map((c) => c.cmd)).toEqual(['wslview', 'powershell.exe', 'xdg-open']);
  });

  it('quotes the path for cmd on win32', () => {
    expect(browserCommands('C:\\d\\a.html', 'win32')).toEqual([{ cmd: 'cmd', args: ['/c', 'start', '""', '"C:\\d\\a.html"'] }]);
  });

  it('keeps spaces and cmd metacharacters inside the quotes', () => {
    const file = 'C:\\Users\\First Last\\a&b (1).html';
    expect(browserCommands(file, 'win32')).toEqual([{ cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`] }]);
  });

  it('refuses win32 paths with a % or " that cmd would interpret', () => {
    for (const file of ['C:\\d\\100%.html', 'C:\\d\\a"b.html']) {
      const result = browserCommands(file, 'win32');
      expect('refused' in result && typeof result.refused).toBe('string');
    }
  });
});

describe('isWsl', () => {
  it('trusts the variables WSL sets', () => {
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true);
    expect(isWsl({ WSL_INTEROP: '/run/WSL/1_interop' })).toBe(true);
  });
});

describe('startCommand', () => {
  it('doubles every quote PowerShell would end the string on', () => {
    expect(startCommand("C:\\d\\it's.html")).toBe("Start-Process -FilePath 'C:\\d\\it''s.html'");
    expect(startCommand('C:\\d\\it’s.html')).toBe("Start-Process -FilePath 'C:\\d\\it’’s.html'");
  });
});

describe('openWith', () => {
  it('hands over to the next opener when one is missing or exits non-zero', async () => {
    expect(await openWith([{ cmd: MISSING, args: [] }, exits(3), exits(0)])).toBeNull();
  });

  it('reports every opener that failed when none opened', async () => {
    expect(await openWith([{ cmd: MISSING, args: [] }, exits(1)])).toBe(`${MISSING} not found; ${NODE} exited with 1`);
  });

  it('takes an opener killed by a signal as failed', async () => {
    const killed = { cmd: NODE, args: ['-e', "process.kill(process.pid, 'SIGKILL')"] };
    expect(await openWith([killed])).toBe(`${NODE} was killed by SIGKILL`);
  });

  it('finds an opener that is off the PATH at its known location', async () => {
    expect(await openWith([{ cmd: MISSING, orAt: NODE, args: ['-e', ''] }])).toBeNull();
    expect(await openWith([{ cmd: MISSING, orAt: `/${MISSING}`, args: [] }])).toBe(`${MISSING} not found`);
  });

  it('hands PowerShell the Windows path of the file as an encoded command', async () => {
    const want = "Start-Process -FilePath '\\\\wsl.localhost\\Ubuntu\\home\\u\\it''s.html'";
    // The child exits 0 only when the argument after its own decodes to the command.
    const check = `process.exit(Buffer.from(process.argv[1], 'base64').toString('utf16le') === ${JSON.stringify(want)} ? 0 : 7)`;
    const windowsPath = (file: string) => {
      if (file !== "/home/u/it's.html") throw new Error(`unexpected ${file}`);
      return "\\\\wsl.localhost\\Ubuntu\\home\\u\\it's.html";
    };
    expect(await openWith([{ cmd: NODE, args: ['-e', check], startFile: "/home/u/it's.html" }], windowsPath)).toBeNull();
  });

  it('says whether wslpath is missing or could not convert the path', async () => {
    const opener = { cmd: NODE, args: ['-e', ''], startFile: '/home/u/a.html' };
    const missing = () => {
      throw Object.assign(new Error('spawnSync wslpath ENOENT'), { code: 'ENOENT' });
    };
    const failing = () => {
      throw new Error('Command failed: wslpath -w /home/u/a.html');
    };
    expect(await openWith([opener], missing)).toBe('wslpath not found');
    expect(await openWith([opener], failing)).toBe("wslpath couldn't convert the path");
  });
});

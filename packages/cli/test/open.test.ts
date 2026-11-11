import { describe, expect, it } from 'vitest';
import { browserCommands, isWsl } from '../src/open';

describe('browserCommands', () => {
  it('uses the native opener on darwin and linux', () => {
    expect(browserCommands('/tmp/a b.html', 'darwin')).toEqual([{ cmd: 'open', args: ['/tmp/a b.html'] }]);
    expect(browserCommands('/tmp/a.html', 'linux', false)).toEqual([{ cmd: 'xdg-open', args: ['/tmp/a.html'] }]);
  });

  it('falls back from xdg-open to wslview, then explorer.exe with a Windows path, on WSL', () => {
    expect(browserCommands('/tmp/a.html', 'linux', true)).toEqual([
      { cmd: 'xdg-open', args: ['/tmp/a.html'] },
      { cmd: 'wslview', args: ['/tmp/a.html'] },
      { cmd: 'explorer.exe', args: ['/tmp/a.html'], windowsPath: true, anyExit: true },
    ]);
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

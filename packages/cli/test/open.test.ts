import { describe, expect, it } from 'vitest';
import { browserCommand } from '../src/open';

describe('browserCommand', () => {
  it('uses the native opener on darwin and linux', () => {
    expect(browserCommand('/tmp/a b.html', 'darwin')).toEqual({ cmd: 'open', args: ['/tmp/a b.html'] });
    expect(browserCommand('/tmp/a.html', 'linux')).toEqual({ cmd: 'xdg-open', args: ['/tmp/a.html'] });
  });

  it('quotes the path for cmd on win32', () => {
    expect(browserCommand('C:\\d\\a.html', 'win32')).toEqual({ cmd: 'cmd', args: ['/c', 'start', '""', '"C:\\d\\a.html"'] });
  });

  it('keeps spaces and cmd metacharacters inside the quotes', () => {
    const file = 'C:\\Users\\First Last\\a&b (1).html';
    expect(browserCommand(file, 'win32')).toEqual({ cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`] });
  });

  it('refuses win32 paths with a % or " that cmd would interpret', () => {
    for (const file of ['C:\\d\\100%.html', 'C:\\d\\a"b.html']) {
      const result = browserCommand(file, 'win32');
      expect('refused' in result && typeof result.refused).toBe('string');
    }
  });
});

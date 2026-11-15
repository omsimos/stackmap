import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return (await import('./standalone')).standalonePage;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('standalonePage', () => {
  it('keeps the delivered page, without the live block a served page carries', async () => {
    document.body.innerHTML =
      '<div id="root"></div><script type="application/json" id="stackmap-data">{"draft":{}}</script>' +
      '<script type="application/json" id="stackmap-live">{"events":"/events","build":"b1"}</script>';
    const page = await load();
    expect(page).toMatch(/^<!doctype html>\n<html/);
    expect(page).toContain('<script type="application/json" id="stackmap-data">{"draft":{}}</script>');
    expect(page).not.toContain('stackmap-live');
    // The live page itself is left alone.
    expect(document.getElementById('stackmap-live')).not.toBeNull();
  });

  it('is undefined when the page embeds no diagram', async () => {
    document.body.innerHTML = '<div id="root"></div><script type="application/json" id="stackmap-data"></script>';
    expect(await load()).toBeUndefined();
  });
});

import { DATA_ELEMENT_ID } from './data';
import { LIVE_ELEMENT_ID } from './live';

/**
 * The page as delivered, read when this module loads, before the viewer renders into it, so Export can save it
 * again as an offline file. main.tsx imports it first for that reason. Undefined where there is no embedded
 * diagram to save (the website's embedded viewer, the dev gallery).
 */
export const standalonePage: string | undefined = (() => {
  if (typeof document === 'undefined' || !document.getElementById(DATA_ELEMENT_ID)?.textContent?.trim()) return undefined;
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  // A page from `stackmap serve` would otherwise keep reconnecting to a server that isn't there.
  root.querySelector(`#${LIVE_ELEMENT_ID}`)?.remove();
  return `<!doctype html>\n${root.outerHTML}`;
})();

import { themeVars, tokens, tokensToCss, type ThemeName } from '@stackmap/core';

export const ACCENT: Record<ThemeName, string> = { light: '#4f63c9', dark: '#8fa6f2' };

/** Where the reader's choice is kept; without one the site follows the system. */
export const THEME_KEY = 'stackmap-theme';

const panel = (name: ThemeName) =>
  `inset 0 0 0 1px ${tokens[name].panelBorder},0 1px 2px rgb(0 0 0 / 0.04),0 8px 24px -12px rgb(0 0 0 / 0.12)`;
const brand = (name: ThemeName) => `--site-accent:${ACCENT[name]};--brand-accent:${ACCENT[name]};--shadow-panel:${panel(name)};`;

const brandRoot = `:root{${brand('light')}}:root[data-theme="dark"]{${brand('dark')}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${brand('dark')}}}`;

// A subtree can still force a theme (a diagram preview, say). These come last so a nested section beats its root.
const section = (name: ThemeName) => `[data-theme="${name}"]{color-scheme:${name};${themeVars(tokens[name])}${brand(name)}}`;

export function themeCss(): string {
  return [tokensToCss(tokens), brandRoot, section('dark'), section('light')].join('\n');
}

// Runs in <head> before the page paints, so a stored choice never flashes the other theme first. `js` tells the CSS
// that script runs, so what it will animate in can start hidden instead of showing and then hiding.
export const THEME_SCRIPT = `document.documentElement.classList.add('js');try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

// Marks the page as loaded a frame after the load event, when the browser has made its own scroll to a #hash:
// site.css turns smooth scrolling on from then.
export const SETTLED_SCRIPT = `addEventListener('load',function(){requestAnimationFrame(function(){document.documentElement.classList.add('settled')})})`;

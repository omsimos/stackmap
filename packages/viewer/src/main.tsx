// First, so it reads the page before anything below changes it.
import './standalone';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens, tokensToCss } from '@stackmap/core';
import './styles.css';
import { App } from './App';
import { fontFaceCss } from './theme/fonts';

const style = document.createElement('style');
style.textContent = fontFaceCss + tokensToCss(tokens);
document.head.prepend(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

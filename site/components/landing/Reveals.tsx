'use client';

import { useEffect } from 'react';
import { gsap, ScrollTrigger } from '@/lib/motion';

/**
 * Content past the hero arrives once as it enters: a 12px rise and fade over 640 ms, 60 ms apart.
 * Only with motion allowed; the server's markup is the resting frame, so nothing here is needed to read the page.
 */
export function Reveals() {
  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // Only what is still below the fold: hiding what the server already painted on screen would blank it.
      const els = gsap.utils.toArray<HTMLElement>('[data-reveal]').filter((el) => el.getBoundingClientRect().top > innerHeight * 0.92);
      gsap.set(els, { autoAlpha: 0, y: 12 });
      ScrollTrigger.batch(els, {
        start: 'top 92%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            autoAlpha: 1,
            y: 0,
            stagger: 0.06,
            duration: 0.64,
            ease: 'stackmap.out',
            clearProps: 'transform,opacity,visibility',
          }),
      });
    });
    return () => mm.revert();
  }, []);
  return null;
}

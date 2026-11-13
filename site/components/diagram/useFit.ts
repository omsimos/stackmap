import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface Size {
  width: number;
  height: number;
}

/**
 * The scale that fits `content` in a box, `pad` in from each side and never past `max`. `initial` is the box at
 * the design size, so the server's markup is already fitted; once mounted the scale follows the box's real size.
 */
export function useFit(content: Size, initial: Size, pad: number, max = 1) {
  const { width, height } = content;
  const fit = useCallback((w: number, h: number) => Math.max(0, Math.min(max, (w - 2 * pad) / width, (h - 2 * pad) / height)), [width, height, pad, max]);
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(() => fit(initial.width, initial.height));
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // A box that isn't laid out measures zero: it keeps the fit it had.
    const measure = () => el.clientWidth && setK(fit(el.clientWidth, el.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);
  return [box, k] as const;
}

import { useEffect, useRef } from 'react';

/**
 * Let a vertical mouse wheel scroll a horizontal strip (shelves, chip rows) while
 * the cursor is over it, instead of scrolling the page. Returns a ref to attach to
 * the scroll container.
 *
 * Trackpad horizontal gestures are left alone, and when the strip is already at its
 * start/end the wheel falls back to the page so you can never get trapped on it.
 */
export function useHorizontalWheel() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      // nothing to scroll, or this is really a horizontal gesture already
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return;

      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      // at an edge and pushing further that way → let the page take the wheel
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) return;

      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}

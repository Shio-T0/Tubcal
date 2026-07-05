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

      // Normalize the delta to pixels. Many mice (esp. on Linux/Firefox) report
      // deltaMode = LINE (1) with a delta of only ~3, which — added raw to
      // scrollLeft — moves the row a couple of pixels per notch and feels broken.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const amount = e.deltaY * unit;

      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      // at an edge and pushing further that way → let the page take the wheel
      if ((atStart && amount < 0) || (atEnd && amount > 0)) return;

      e.preventDefault();
      el.scrollLeft += amount;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}

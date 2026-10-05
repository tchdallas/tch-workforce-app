import { useState, useEffect, useRef } from 'react';

// Pull-to-refresh that stays out of the way. The previous version made the
// whole app feel laggy on phones, two ways at once:
//   * it armed on EVERY touch — it checked documentElement.scrollTop, which is
//     always 0 in this app-shell layout (the <main> pane scrolls, not the page)
//   * it setState'd on every touchmove pixel, re-rendering the entire page
//     (Dashboard and its dozen queries) continuously during scrolls and even
//     during the tiny drift inside a normal tap
// Now the gesture is tracked in refs, the REAL scroller is consulted, and
// nothing renders until the finger has deliberately pulled down from the top.
const SLOP = 14; // px of downward travel before we treat it as a pull

export default function usePullToRefresh(onRefresh, threshold = 72) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef(null);
  const s = useRef({ startY: null, pulling: false, pull: 0, busy: false });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  useEffect(() => {
    const scroller = () =>
      containerRef.current || document.querySelector('main') || document.documentElement;

    const onTouchStart = (e) => {
      const st = s.current;
      st.startY = scroller().scrollTop <= 0 ? e.touches[0].clientY : null;
      st.pulling = false;
      st.pull = 0;
    };

    const onTouchMove = (e) => {
      const st = s.current;
      if (st.startY === null || st.busy) return;
      const delta = e.touches[0].clientY - st.startY;
      if (!st.pulling) {
        if (delta < SLOP) return; // a tap or an ordinary scroll — render nothing
        st.pulling = true;
      }
      st.pull = Math.max(0, Math.min((delta - SLOP) * 0.5, thresholdRef.current * 1.5));
      setPullDistance(st.pull);
    };

    const onTouchEnd = async () => {
      const st = s.current;
      const shouldRefresh = st.pulling && st.pull >= thresholdRef.current && !st.busy;
      st.startY = null;
      st.pulling = false;
      st.pull = 0;
      setPullDistance(0); // no-op render unless a pull was actually drawn
      if (shouldRefresh) {
        st.busy = true;
        setRefreshing(true);
        try {
          await refreshRef.current();
        } finally {
          st.busy = false;
          setRefreshing(false);
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return { pullDistance, refreshing, containerRef };
}

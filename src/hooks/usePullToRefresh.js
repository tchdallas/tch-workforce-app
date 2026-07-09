import { useState, useEffect, useRef } from 'react';

export default function usePullToRefresh(onRefresh, threshold = 72) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current || window;

    const onTouchStart = (e) => {
      const scrollTop = containerRef.current
        ? containerRef.current.scrollTop
        : document.documentElement.scrollTop;
      if (scrollTop === 0) startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0) {
        setPullDistance(Math.min(delta * 0.5, threshold * 1.5));
      }
    };

    const onTouchEnd = async () => {
      if (pullDistance >= threshold) {
        setRefreshing(true);
        await onRefresh();
        setRefreshing(false);
      }
      setPullDistance(0);
      startY.current = null;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [pullDistance, refreshing, onRefresh, threshold]);

  return { pullDistance, refreshing, containerRef };
}
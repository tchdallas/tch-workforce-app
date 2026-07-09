import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function PullToRefreshIndicator({ pullDistance, refreshing, threshold = 72 }) {
  const progress = Math.min(pullDistance / threshold, 1);
  const visible = pullDistance > 8 || refreshing;

  if (!visible) return null;

  return (
    <div
      className="flex items-center justify-center transition-all duration-150"
      style={{ height: refreshing ? 48 : pullDistance * 0.67, overflow: 'hidden' }}
    >
      <div
        className="w-9 h-9 rounded-full bg-card border border-border shadow flex items-center justify-center"
        style={{ opacity: progress }}
      >
        <RefreshCw
          className={`w-4 h-4 text-primary ${refreshing ? 'animate-spin' : ''}`}
          style={{ transform: `rotate(${progress * 180}deg)` }}
        />
      </div>
    </div>
  );
}
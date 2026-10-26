import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function StatCard({ label, value, icon: Icon, variant = 'default', onClick, to }) {
  const variants = {
    default: 'border-border',
    warning: 'border-amber-400/30 bg-amber-50 dark:bg-amber-950/20',
    danger: 'border-red-400/30 bg-red-50 dark:bg-red-950/20',
    success: 'border-emerald-400/30 bg-emerald-50 dark:bg-emerald-950/20',
    accent: 'border-primary/20 bg-primary/5',
  };

  // `to` makes the tile a real link (the pointer cursor finally keeps its promise)
  const card = (
    <Card
      className={cn(
        "p-4 transition-shadow",
        (to || onClick) && "cursor-pointer hover:shadow-md",
        variants[variant]
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block">{card}</Link> : card;
}
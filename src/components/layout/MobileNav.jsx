import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Calendar, Radio, HandHelping, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const mobileNavItems = [
  { label: 'Home', icon: LayoutDashboard, path: '/' },
  { label: 'Schedule', icon: Calendar, path: '/schedule' },
  { label: 'Roadmap', icon: Radio, path: '/roadmap' },
  { label: 'Open Shifts', icon: HandHelping, path: '/open-shifts' },
  { label: 'Profile', icon: User, path: '/my-profile' },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: 'var(--safe-area-bottom)' }}
    >
      <div className="flex items-center justify-around h-16 px-1">
        {mobileNavItems.map(item => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors min-w-[56px]",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className={cn("w-5 h-5", isActive && "stroke-[2.5]")} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
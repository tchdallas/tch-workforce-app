import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useAuth } from '@/lib/AuthContext';
import {
  visibleGroupsFor, footerNavItems, isPathActive, activeGroupLabel,
  loadOpenGroups, saveOpenGroups,
} from './navConfig';

export default function MobileMenu({ open, onClose }) {
  const location = useLocation();
  const { isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const groups = visibleGroupsFor({ isManager, isAdmin });
  const [openGroups, setOpenGroups] = useState(loadOpenGroups);

  const activeGroup = activeGroupLabel(location.pathname);
  const isGroupOpen = (label) => label === activeGroup || openGroups[label] !== false;

  const toggleGroup = (label) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: prev[label] === false ? true : false };
      saveOpenGroups(next);
      return next;
    });
  };

  const NavLink = ({ item }) => {
    const active = isPathActive(location.pathname, item.path);
    return (
      <Link
        to={item.path}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-sidebar-accent text-sidebar-primary'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        )}
      >
        <item.icon className="w-5 h-5 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-[280px] p-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <span className="text-sidebar-primary-foreground font-bold text-sm">T</span>
            </div>
            TCH Workforce
          </SheetTitle>
        </SheetHeader>

        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45 hover:text-sidebar-foreground/70 transition-colors"
              >
                <span>{group.label}</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isGroupOpen(group.label) && '-rotate-90')} />
              </button>
              {isGroupOpen(group.label) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => <NavLink key={item.path} item={item} />)}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-sidebar-border space-y-0.5">
          {footerNavItems.map((item) => <NavLink key={item.path} item={item} />)}
          <button
            type="button"
            onClick={() => { onClose(); logout(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useAuth } from '@/lib/AuthContext';
import {
  visibleGroupsFor, footerNavItems, isPathActive, activeGroupLabel,
  loadOpenGroups, saveOpenGroups,
} from './navConfig';

export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();
  const { isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const groups = visibleGroupsFor({ isManager, isAdmin });
  const [openGroups, setOpenGroups] = useState(loadOpenGroups);

  // A group is open unless explicitly collapsed; the group holding the current
  // page always stays open so the active item is never hidden.
  const activeGroup = activeGroupLabel(location.pathname);
  const isOpen = (label) => label === activeGroup || openGroups[label] !== false;

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
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          collapsed && 'justify-center',
          active
            ? 'bg-sidebar-accent text-sidebar-primary'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        )}
      >
        <item.icon className="w-5 h-5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn(
      "hidden lg:flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 h-screen sticky top-0",
      collapsed ? "w-[72px]" : "w-[240px]"
    )}>
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-8 h-8" />
            <span className="font-display text-xl tracking-wide text-sidebar-foreground">TCH WORKFORCE</span>
          </div>
        )}
        {collapsed && (
          <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-8 h-8 mx-auto" />
        )}
      </div>

      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {groups.map((group, gi) => (
          collapsed ? (
            // icon rail: no headers — just show every item, divider between groups
            <div key={group.label}>
              {gi > 0 && <div className="my-1.5 mx-2 border-t border-sidebar-border/60" />}
              <div className="space-y-0.5">
                {group.items.map((item) => <NavLink key={item.path} item={item} />)}
              </div>
            </div>
          ) : (
            <div key={group.label} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45 hover:text-sidebar-foreground/70 transition-colors"
              >
                <span>{group.label}</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isOpen(group.label) && '-rotate-90')} />
              </button>
              {isOpen(group.label) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => <NavLink key={item.path} item={item} />)}
                </div>
              )}
            </div>
          )
        ))}
      </nav>

      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        {footerNavItems.map((item) => <NavLink key={item.path} item={item} />)}
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            "w-full gap-3 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
            !collapsed && "justify-start px-3"
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>
    </aside>
  );
}

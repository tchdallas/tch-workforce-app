import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useUiPrefs } from '@/hooks/useUiPrefs';
import { useAuth } from '@/lib/AuthContext';
import {
  visibleGroupsFor, footerNavItems, isPathActive, activeGroupLabel,
  loadOpenGroup, saveOpenGroup, findNavItem,
} from './navConfig';

// hex -> rgba, for the faint colored rail on inactive items
const hexA = (hex, a) => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();
  const { member, isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const groups = visibleGroupsFor({ isManager, isAdmin });

  // Favorites — per member, pinned to a section at the very top.
  // Stored in the DB (useUiPrefs) so they follow the person across devices.
  const { favorites, setFavorites } = useUiPrefs();
  const toggleFavorite = (path) => setFavorites(
    favorites.includes(path) ? favorites.filter((p) => p !== path) : [...favorites, path]
  );

  // Only pin favorites the user can actually reach.
  const visiblePaths = new Set();
  groups.forEach((g) => g.items.forEach((it) => visiblePaths.add(it.path)));
  footerNavItems.forEach((it) => visiblePaths.add(it.path));
  const favoriteItems = favorites
    .map(findNavItem)
    .filter((x) => x && visiblePaths.has(x.item.path));

  // Accordion: at most one group open. Follows navigation — landing on a page
  // opens that page's group (and closes the rest).
  const activeGroup = activeGroupLabel(location.pathname);
  const [openLabel, setOpenLabel] = useState(() => loadOpenGroup() ?? activeGroup);
  React.useEffect(() => {
    if (activeGroup) { setOpenLabel(activeGroup); saveOpenGroup(activeGroup); }
  }, [activeGroup]);

  const isOpen = (label) => label === openLabel;
  const toggleGroup = (label) => {
    const next = openLabel === label ? null : label;
    setOpenLabel(next);
    saveOpenGroup(next);
  };

  const NavLink = ({ item, color, keyPrefix = '' }) => {
    const active = isPathActive(location.pathname, item.path);
    const fav = favorites.includes(item.path);
    return (
      <div className="relative group/nav">
        <Link
          to={item.path}
          title={collapsed ? item.label : undefined}
          style={color && !collapsed
            ? { borderLeft: `3px solid ${active ? color : hexA(color, 0.4)}` }
            : undefined}
          className={cn(
            'flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-0' : 'pl-2.5 pr-8',
            active
              ? 'bg-sidebar-accent text-sidebar-primary'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
          )}
        >
          <item.icon className="w-5 h-5 shrink-0" style={active && color ? { color } : undefined} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.path); }}
            title={fav ? 'Remove from Favorites' : 'Add to Favorites'}
            aria-label={fav ? 'Remove from Favorites' : 'Add to Favorites'}
            className={cn(
              'absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity',
              fav ? 'opacity-100' : 'opacity-0 group-hover/nav:opacity-100'
            )}
          >
            <Star className={cn('w-3.5 h-3.5', fav ? 'fill-amber-400 text-amber-400' : 'text-sidebar-foreground/50 hover:text-sidebar-foreground')} />
          </button>
        )}
      </div>
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
        {/* Favorites — pinned to the top */}
        {favoriteItems.length > 0 && (
          collapsed ? (
            <div>
              <div className="space-y-0.5">
                {favoriteItems.map(({ item, color }) => <NavLink key={'fav-' + item.path} item={item} color={color} />)}
              </div>
              <div className="my-1.5 mx-2 border-t border-sidebar-border/60" />
            </div>
          ) : (
            <div className="mb-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Favorites
              </div>
              <div className="space-y-0.5 mt-0.5">
                {favoriteItems.map(({ item, color }) => <NavLink key={'fav-' + item.path} item={item} color={color} />)}
              </div>
            </div>
          )
        )}

        {groups.map((group, gi) => (
          collapsed ? (
            // icon rail: no headers — just show every item, divider between groups
            <div key={group.label}>
              {gi > 0 && <div className="my-1.5 mx-2 border-t border-sidebar-border/60" />}
              <div className="space-y-0.5">
                {group.items.map((item) => <NavLink key={item.path} item={item} color={group.color} />)}
              </div>
            </div>
          ) : (
            <div key={group.label} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45 hover:text-sidebar-foreground/70 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                  {group.label}
                </span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isOpen(group.label) && '-rotate-90')} />
              </button>
              {isOpen(group.label) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => <NavLink key={item.path} item={item} color={group.color} />)}
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

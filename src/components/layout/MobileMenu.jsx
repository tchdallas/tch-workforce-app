import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useUiPrefs } from '@/hooks/useUiPrefs';
import { useNavBadges } from '@/hooks/useNavBadges';
import NavBadge from './NavBadge';
import { useAuth } from '@/lib/AuthContext';
import {
  visibleGroupsFor, footerNavItems, isPathActive, activeGroupLabel,
  loadOpenGroup, saveOpenGroup, findNavItem,
} from './navConfig';

const hexA = (hex, a) => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export default function MobileMenu({ open, onClose }) {
  const location = useLocation();
  const { member, isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const groups = visibleGroupsFor({ isManager, isAdmin });

  // DB-backed favorites — same row the desktop sidebar uses, so pins sync
  const { favorites, setFavorites } = useUiPrefs();
  const { byPath: badges } = useNavBadges();
  const toggleFavorite = (path) => setFavorites(
    favorites.includes(path) ? favorites.filter((p) => p !== path) : [...favorites, path]
  );

  const visiblePaths = new Set();
  groups.forEach((g) => g.items.forEach((it) => visiblePaths.add(it.path)));
  footerNavItems.forEach((it) => visiblePaths.add(it.path));
  const favoriteItems = favorites.map(findNavItem).filter((x) => x && visiblePaths.has(x.item.path));

  // Accordion: at most one group open, following the active page.
  const activeGroup = activeGroupLabel(location.pathname);
  const [openLabel, setOpenLabel] = useState(() => loadOpenGroup() ?? activeGroup);
  React.useEffect(() => {
    if (activeGroup) { setOpenLabel(activeGroup); saveOpenGroup(activeGroup); }
  }, [activeGroup]);

  const isGroupOpen = (label) => label === openLabel;
  const toggleGroup = (label) => {
    const next = openLabel === label ? null : label;
    setOpenLabel(next);
    saveOpenGroup(next);
  };

  const NavLink = ({ item, color }) => {
    const active = isPathActive(location.pathname, item.path);
    const fav = favorites.includes(item.path);
    return (
      <div className="relative">
        <Link
          to={item.path}
          onClick={onClose}
          style={color ? { borderLeft: `3px solid ${active ? color : hexA(color, 0.4)}` } : undefined}
          className={cn(
            'flex items-center gap-3 pl-2.5 pr-9 py-2.5 rounded-lg text-sm font-medium transition-colors',
            active
              ? 'bg-sidebar-accent text-sidebar-primary'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
          )}
        >
          <item.icon className="w-5 h-5 shrink-0" style={active && color ? { color } : undefined} />
          <span className="truncate">{item.label}</span>
          {/* ml-auto lands it inside the pr-9 gutter, clear of the favourite star */}
          <NavBadge count={badges[item.path]} className="ml-auto" />
        </Link>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.path); }}
          aria-label={fav ? 'Remove from Favorites' : 'Add to Favorites'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded"
        >
          <Star className={cn('w-4 h-4', fav ? 'fill-amber-400 text-amber-400' : 'text-sidebar-foreground/40')} />
        </button>
      </div>
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
          {favoriteItems.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Favorites
              </div>
              <div className="space-y-0.5 mt-0.5">
                {favoriteItems.map(({ item, color }) => <NavLink key={'fav-' + item.path} item={item} color={color} />)}
              </div>
            </div>
          )}

          {groups.map((group) => (
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
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isGroupOpen(group.label) && '-rotate-90')} />
              </button>
              {isGroupOpen(group.label) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => <NavLink key={item.path} item={item} color={group.color} />)}
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

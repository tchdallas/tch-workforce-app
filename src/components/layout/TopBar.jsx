import React from 'react';
import { Bell, Menu, Sun, Moon, Monitor, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/ThemeContext';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
import { useNavBadges } from '@/hooks/useNavBadges';
import NavBadge from './NavBadge';

export default function TopBar({ onMobileMenuOpen, onHelp }) {
  const { theme, setTheme } = useTheme();
  const { byPath, total } = useNavBadges();

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  return (
    <header
      className="border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-40"
      style={{ height: 'calc(3.5rem + var(--safe-area-top))', paddingTop: 'var(--safe-area-top)' }}
    >
      <div className="flex items-center gap-3">
        {/* Thumb targets, not icon boxes. size="icon" is 36px — under both Android's
            48dp and Apple's 44pt minimum — and this corner is the worst place for a
            small one: Android's left-edge back-swipe zone and Chrome's URL bar both
            sit right on top of it, so near-misses get eaten instead of tapped. The
            ::before pad stretches the touchable area past the visible button (out to
            the screen edge and the full header height) without moving any layout. */}
        {/* Always the menu. This used to flip to a back chevron on any route
            outside ROOT_PATHS, which meant the nav menu was unreachable from
            most of the app — Team Members, Timesheets, Policies, Attendance,
            Reports and the rest had no way to open it, and the bottom bar only
            carries five destinations. "Back" is what the phone's own back
            button and edge-swipe are for; pages that genuinely need one carry
            an in-page link (see Policies detail). */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={total > 0 ? `Open menu — ${total} needing attention` : 'Open menu'}
          className="lg:hidden h-11 w-11 active:bg-accent relative before:absolute before:content-[''] before:-inset-2"
          onClick={onMobileMenuOpen}
        >
          <Menu className="w-5 h-5" />
          {/* everything wanting you, across every screen — the menu is the only
              way in to most of them on a phone */}
          <NavBadge count={total} className="absolute -top-0.5 -right-0.5" />
        </Button>
        <div className="lg:hidden flex items-center gap-2">
          <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-7 h-7" />
          <span className="font-display text-lg tracking-wide">TCH WORKFORCE</span>
        </div>
      </div>

      {/* These three can't grow sideways — three 44px buttons plus the wordmark
          overflow a 393px phone. So the pad grows vertically (dead header space,
          no neighbours) and only 4px horizontally, exactly half the gap-2 between
          them, so neighbouring targets meet but never overlap into mis-taps. */}
      <div className="flex items-center gap-2 [&_button]:active:bg-accent [&_button]:before:absolute [&_button]:before:content-[''] [&_button]:before:-inset-y-2 [&_button]:before:-inset-x-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme" className="relative">
              <ThemeIcon className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('device')}>
              <Monitor className="w-4 h-4 mr-2" /> Use Device Setting
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun className="w-4 h-4 mr-2" /> Light Mode
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon className="w-4 h-4 mr-2" /> Dark Mode
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" onClick={onHelp} title="App tour" aria-label="App tour" className="relative">
          <HelpCircle className="w-4 h-4" />
        </Button>

        <Link to="/notifications" className="flex">
          <Button
            variant="ghost" size="icon"
            aria-label={byPath['/notifications'] > 0
              ? `Notifications — ${byPath['/notifications']} unread`
              : 'Notifications'}
            className="relative"
          >
            <Bell className="w-4 h-4" />
            {/* this button has carried `relative` since it was written but never
                rendered anything into it — unread count has always been invisible */}
            <NavBadge count={byPath['/notifications']} className="absolute -top-1 -right-1" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
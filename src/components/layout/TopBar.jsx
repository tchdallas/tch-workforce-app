import React from 'react';
import { Bell, Menu, Sun, Moon, Monitor, ChevronLeft, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/ThemeContext';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const ROOT_PATHS = new Set(['/', '/schedule', '/roadmap', '/open-shifts']);

export default function TopBar({ onMobileMenuOpen, onHelp }) {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const isSubRoute = !ROOT_PATHS.has(location.pathname);

  return (
    <header
      className="border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-40"
      style={{ height: 'calc(3.5rem + var(--safe-area-top))', paddingTop: 'var(--safe-area-top)' }}
    >
      <div className="flex items-center gap-3">
        {isSubRoute ? (
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => navigate(-1)}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMobileMenuOpen}>
            <Menu className="w-5 h-5" />
          </Button>
        )}
        <div className="lg:hidden flex items-center gap-2">
          <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-7 h-7" />
          <span className="font-display text-lg tracking-wide">TCH WORKFORCE</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
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

        <Button variant="ghost" size="icon" onClick={onHelp} title="App tour" aria-label="App tour">
          <HelpCircle className="w-4 h-4" />
        </Button>

        <Link to="/notifications">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
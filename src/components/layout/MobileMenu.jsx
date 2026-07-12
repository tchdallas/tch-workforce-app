import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, LayoutDashboard, Calendar, Radio, Users, MapPin, Shield, BarChart3, Settings, Bell, ClipboardList, AlertTriangle, HandHelping, Activity, LayoutTemplate, CalendarCheck, LogOut, Target, UserCheck, MessageSquare, Megaphone, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useAuth } from '@/lib/AuthContext';

const allNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', managerOnly: false },
  { label: 'Schedule', icon: Calendar, path: '/schedule', managerOnly: false },
  { label: 'My Schedule', icon: CalendarCheck, path: '/my-schedule', managerOnly: false },
  { label: 'Messages', icon: MessageSquare, path: '/messages', managerOnly: false },
  { label: 'Announcements', icon: Megaphone, path: '/announcements', managerOnly: false },
  { label: 'Templates', icon: LayoutTemplate, path: '/schedule-templates', managerOnly: true },
  { label: 'Live Roadmap', icon: Radio, path: '/roadmap', managerOnly: false },
  { label: 'Open Shifts', icon: HandHelping, path: '/open-shifts', managerOnly: false },
  { label: 'Requests', icon: ClipboardList, path: '/requests', managerOnly: true },
  { label: 'Callouts', icon: AlertTriangle, path: '/callouts', managerOnly: true },
  { label: 'Team Members', icon: Users, path: '/team-members', managerOnly: true },
  { label: 'Locations', icon: MapPin, path: '/locations', managerOnly: true },
  { label: 'Roles', icon: Shield, path: '/roles', managerOnly: true },
  { label: 'Par Levels', icon: Target, path: '/par-levels', adminOnly: true },
  { label: 'Attendance', icon: UserCheck, path: '/attendance', managerOnly: true },
  { label: 'Downs', icon: Trophy, path: '/downs', managerOnly: true },
  { label: 'Reports', icon: BarChart3, path: '/reports', managerOnly: true },
  { label: 'Notifications', icon: Bell, path: '/notifications', managerOnly: false },
  { label: 'Audit Log', icon: Activity, path: '/audit-log', managerOnly: true },
  { label: 'Settings', icon: Settings, path: '/settings', adminOnly: true },
];

export default function MobileMenu({ open, onClose }) {
  const location = useLocation();
  const { isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const navItems = allNavItems.filter(item =>
    (!item.managerOnly || isManager) && (!item.adminOnly || isAdmin)
  );

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-[280px] p-0 bg-sidebar text-sidebar-foreground">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <span className="text-sidebar-primary-foreground font-bold text-sm">T</span>
            </div>
            TCH Workforce
          </SheetTitle>
        </SheetHeader>
        <nav className="py-3 px-2 space-y-0.5">
          {navItems.map(item => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => { onClose(); logout(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground border-t border-sidebar-border mt-2 pt-3"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
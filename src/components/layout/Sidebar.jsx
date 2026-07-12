import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, Radio, Users, MapPin, Shield, BarChart3,
  Settings, Bell, ClipboardList, AlertTriangle, HandHelping, ChevronLeft, ChevronRight,
  Activity, User, LayoutTemplate, CalendarCheck, Clock, LogOut, Target, UserCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useAuth } from '@/lib/AuthContext';

const allNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', managerOnly: false },
  { label: 'Schedule', icon: Calendar, path: '/schedule', managerOnly: false },
  { label: 'My Schedule', icon: CalendarCheck, path: '/my-schedule', managerOnly: false },
  { label: 'Templates', icon: LayoutTemplate, path: '/schedule-templates', managerOnly: true },
  { label: 'Live Roadmap', icon: Radio, path: '/roadmap', managerOnly: false },
  { label: 'Open Shifts', icon: HandHelping, path: '/open-shifts', managerOnly: false },
  { label: 'Requests', icon: ClipboardList, path: '/requests', managerOnly: true },
  { label: 'Callouts', icon: AlertTriangle, path: '/callouts', managerOnly: true },
  { label: 'Team Members', icon: Users, path: '/team-members', managerOnly: true },
  { label: 'Locations', icon: MapPin, path: '/locations', managerOnly: true },
  { label: 'Roles', icon: Shield, path: '/roles', managerOnly: true },
  { label: 'Par Levels', icon: Target, path: '/par-levels', adminOnly: true },
  { label: 'Timesheets', icon: Clock, path: '/timesheets', managerOnly: true },
  { label: 'Attendance', icon: UserCheck, path: '/attendance', managerOnly: true },
  { label: 'Reports', icon: BarChart3, path: '/reports', managerOnly: true },
  { label: 'Notifications', icon: Bell, path: '/notifications', managerOnly: false },
  { label: 'Audit Log', icon: Activity, path: '/audit-log', managerOnly: true },
  { label: 'My Profile', icon: User, path: '/my-profile', managerOnly: false },
  { label: 'Settings', icon: Settings, path: '/settings', adminOnly: true },
];

export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();
  const { isManager, isAdmin } = useCurrentMember();
  const { logout } = useAuth();

  const navItems = allNavItems.filter(item =>
    (!item.managerOnly || isManager) && (!item.adminOnly || isAdmin)
  );

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

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map(item => {
          const isActive = location.pathname === item.path || 
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-sidebar-border space-y-0.5">
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
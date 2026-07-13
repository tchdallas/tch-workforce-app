// Single source of truth for the app's navigation, shared by the desktop
// Sidebar and the MobileMenu so they never drift apart. Items carry the same
// managerOnly/adminOnly gating as before; groups render as collapsible sections.
import {
  LayoutDashboard, Radio, Calendar, CalendarCheck, LayoutTemplate, HandHelping,
  ClipboardList, AlertTriangle, Clock, Trophy, Users, UserCheck, MessageSquare,
  Megaphone, BarChart3, Activity, MapPin, Shield, Target, Settings, Bell, User, Bug,
} from 'lucide-react';

export const navGroups = [
  { label: 'Overview', items: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Live Roadmap', icon: Radio, path: '/roadmap' },
  ] },
  { label: 'Scheduling', items: [
    { label: 'Schedule', icon: Calendar, path: '/schedule' },
    { label: 'My Schedule', icon: CalendarCheck, path: '/my-schedule' },
    { label: 'Templates', icon: LayoutTemplate, path: '/schedule-templates', managerOnly: true },
    { label: 'Open Shifts', icon: HandHelping, path: '/open-shifts' },
  ] },
  { label: 'Requests', items: [
    { label: 'Requests', icon: ClipboardList, path: '/requests', managerOnly: true },
    { label: 'Callouts', icon: AlertTriangle, path: '/callouts', managerOnly: true },
  ] },
  { label: 'Time & Pay', items: [
    { label: 'Timesheets', icon: Clock, path: '/timesheets', managerOnly: true },
    { label: 'Downs', icon: Trophy, path: '/downs', managerOnly: true },
  ] },
  { label: 'Team', items: [
    { label: 'Team Members', icon: Users, path: '/team-members', managerOnly: true },
    { label: 'Attendance', icon: UserCheck, path: '/attendance', managerOnly: true },
  ] },
  { label: 'Communication', items: [
    { label: 'Messages', icon: MessageSquare, path: '/messages' },
    { label: 'Announcements', icon: Megaphone, path: '/announcements' },
  ] },
  { label: 'Insights', items: [
    { label: 'Reports', icon: BarChart3, path: '/reports', managerOnly: true },
    { label: 'Audit Log', icon: Activity, path: '/audit-log', managerOnly: true },
    { label: 'Bug Reports', icon: Bug, path: '/bug-reports', managerOnly: true },
  ] },
  { label: 'Setup', items: [
    { label: 'Locations', icon: MapPin, path: '/locations', managerOnly: true },
    { label: 'Roles', icon: Shield, path: '/roles', managerOnly: true },
    { label: 'Par Levels', icon: Target, path: '/par-levels', adminOnly: true },
    { label: 'Settings', icon: Settings, path: '/settings', adminOnly: true },
  ] },
];

// Personal items — pinned at the very bottom, outside the collapsible groups.
export const footerNavItems = [
  { label: 'Notifications', icon: Bell, path: '/notifications' },
  { label: 'My Profile', icon: User, path: '/my-profile' },
];

// Every place a member can navigate to (groups + personal items), flattened —
// the catalog the dashboard's customizable Quick Actions picks from. Dashboard
// itself is excluded (no point linking to the page you're on).
export function quickActionCatalog(perms) {
  const items = [];
  visibleGroupsFor(perms).forEach((g) => g.items.forEach((it) => items.push(it)));
  footerNavItems.forEach((it) => items.push(it));
  return items.filter((it) => it.path !== '/');
}

// Sensible starting Quick Actions per role (mirror what the dashboard shipped
// with). Users can change these; unknown/inaccessible paths are filtered out.
export const defaultQuickActions = {
  manager: ['/schedule', '/roadmap', '/team-members', '/requests'],
  member: ['/my-schedule', '/open-shifts', '/roadmap', '/my-profile'],
};

// Keeps a member's visible items only, then drops any group left empty.
export function visibleGroupsFor({ isManager, isAdmin }) {
  const allowed = (item) => (!item.managerOnly || isManager) && (!item.adminOnly || isAdmin);
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
}

// Which group holds the currently-active path (so it can start expanded).
export function activeGroupLabel(pathname) {
  const match = (path) => pathname === path || (path !== '/' && pathname.startsWith(path));
  const group = navGroups.find((g) => g.items.some((it) => match(it.path)));
  return group?.label;
}

export const isPathActive = (pathname, path) =>
  pathname === path || (path !== '/' && pathname.startsWith(path));

const STORAGE_KEY = 'tch-nav-open-groups';

export function loadOpenGroups() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveOpenGroups(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota/availability errors — collapse state is non-critical
  }
}

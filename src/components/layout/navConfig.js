// Single source of truth for the app's navigation, shared by the desktop
// Sidebar and the MobileMenu so they never drift apart. Items carry the same
// managerOnly/adminOnly gating as before; groups render as collapsible sections.
import {
  LayoutDashboard, Radio, Calendar, CalendarCheck, LayoutTemplate, HandHelping,
  ClipboardList, AlertTriangle, Clock, Trophy, Users, UserCheck, MessageSquare,
  Megaphone, BarChart3, Activity, MapPin, Shield, Target, Settings, Bell, User, Bug, MessageSquarePlus,
} from 'lucide-react';

// Each group carries an accent color so sections are scannable at a glance
// (a dot on the header + a left rail on its items).
export const navGroups = [
  { label: 'Overview', color: '#d2ad74', items: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Live Roadmap', icon: Radio, path: '/roadmap' },
  ] },
  { label: 'Scheduling', color: '#3b82f6', items: [
    { label: 'Schedule', icon: Calendar, path: '/schedule' },
    { label: 'My Schedule', icon: CalendarCheck, path: '/my-schedule' },
    { label: 'Templates', icon: LayoutTemplate, path: '/schedule-templates', managerOnly: true },
    { label: 'Par Levels', icon: Target, path: '/par-levels', adminOnly: true },
    { label: 'Open Shifts', icon: HandHelping, path: '/open-shifts' },
  ] },
  { label: 'Requests', color: '#f59e0b', items: [
    { label: 'Requests', icon: ClipboardList, path: '/requests', managerOnly: true },
    { label: 'Callouts', icon: AlertTriangle, path: '/callouts', managerOnly: true },
  ] },
  { label: 'Time & Pay', color: '#10b981', items: [
    { label: 'Timesheets', icon: Clock, path: '/timesheets', managerOnly: true },
    { label: 'Downs', icon: Trophy, path: '/downs', managerOnly: true },
  ] },
  { label: 'Team', color: '#8b5cf6', items: [
    { label: 'Team Members', icon: Users, path: '/team-members', managerOnly: true },
    { label: 'Attendance', icon: UserCheck, path: '/attendance', managerOnly: true },
  ] },
  { label: 'Communication', color: '#0ea5e9', items: [
    { label: 'Messages', icon: MessageSquare, path: '/messages' },
    { label: 'Announcements', icon: Megaphone, path: '/announcements' },
  ] },
  { label: 'Insights', color: '#f43f5e', items: [
    { label: 'Reports', icon: BarChart3, path: '/reports', managerOnly: true },
    { label: 'Audit Log', icon: Activity, path: '/audit-log', managerOnly: true },
    { label: 'Feedback', icon: MessageSquarePlus, path: '/bug-reports', managerOnly: true },
  ] },
  { label: 'Setup', color: '#64748b', items: [
    { label: 'Locations', icon: MapPin, path: '/locations', managerOnly: true },
    { label: 'Roles', icon: Shield, path: '/roles', managerOnly: true },
    { label: 'Settings', icon: Settings, path: '/settings', adminOnly: true },
  ] },
];

export const FAVORITE_COLOR = '#eab308'; // gold star accent for the Favorites section

// Resolve any nav path to its item definition + its group's accent color.
export function findNavItem(path) {
  for (const g of navGroups) {
    const it = g.items.find((i) => i.path === path);
    if (it) return { item: it, color: g.color };
  }
  const f = footerNavItems.find((i) => i.path === path);
  if (f) return { item: f, color: FAVORITE_COLOR };
  return null;
}

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

// Accordion state: exactly ONE group open at a time (or none). Stored as the
// open group's label, per device — which device you're on is exactly the kind
// of thing this should remember. (Favorites/quick actions are cross-device
// and live in the DB via useUiPrefs.)
const OPEN_GROUP_KEY = 'tch-nav-open-group';

export function loadOpenGroup() {
  try {
    const v = localStorage.getItem(OPEN_GROUP_KEY);
    return v === null || v === '' ? null : v;
  } catch {
    return null;
  }
}

export function saveOpenGroup(label) {
  try {
    localStorage.setItem(OPEN_GROUP_KEY, label || '');
  } catch {
    // ignore quota/availability errors — collapse state is non-critical
  }
}

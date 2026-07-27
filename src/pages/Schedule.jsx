import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import ViewSchedule from './ViewSchedule';
import { startOfWeek, addDays, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Clipboard, Upload, FileText, Search, X } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import WeekSelector from '@/components/schedule/WeekSelector';
import ScheduleGrid from '@/components/schedule/ScheduleGrid';
import ShiftModal from '@/components/schedule/ShiftModal';
import ViewDropdown, { getViewConfig } from '@/components/schedule/ViewDropdown';
import ImportPaylocityModal from '@/components/schedule/ImportPaylocityModal';
import PasteRoleWarningDialog from '@/components/schedule/PasteRoleWarningDialog';
import PasteConflictDialog from '@/components/schedule/PasteConflictDialog';
import PublishButton from '@/components/schedule/PublishButton';
import DayViewSummary from '@/components/schedule/DayViewSummary';
import DayTimeline from '@/components/schedule/DayTimeline';
import ImportTemplateModal from '@/components/schedule/ImportTemplateModal';
import RolePanel from '@/components/schedule/RolePanel';
import TeamMemberModal from '@/components/team/TeamMemberModal';
import { useLocations, useRoles, useTeamMembers, usePars, useParTemplates, useAllAvailability, businessDayStartHour, scheduleRoleOrder, sortRolesByOrder } from '@/lib/useAppData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Target } from 'lucide-react';
import { roleDayCoverage } from '@/lib/parCoverage';
import { toast } from 'sonner';

function ScheduleBuilder({ assignedLocationIds = [] }) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [selectedLocation, setSelectedLocation] = useState('');
  // remember the last view they used, per device
  const [viewKey, setViewKey] = useState(() => {
    try { return localStorage.getItem('tch-schedule-view') || 'role_week'; } catch { return 'role_week'; }
  });
  useEffect(() => { try { localStorage.setItem('tch-schedule-view', viewKey); } catch { /* ignore */ } }, [viewKey]);
  const { groupBy: viewMode, days: spanDays } = getViewConfig(viewKey);
  const [shiftModal, setShiftModal] = useState({ open: false, shift: null });
  const [memberModal, setMemberModal] = useState({ open: false, member: null });
  const [importModal, setImportModal] = useState(false);
  const [importTemplateModal, setImportTemplateModal] = useState(false);
  const [tmSearch, setTmSearch] = useState('');
  const [tmSearchResults, setTmSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef(null);
  const scrollToTmRef = useRef(null); // callback set by ScheduleGrid

  // Clipboard & selection state
  // clipboard: { shifts: Shift[], mode: 'copy'|'cut', sourceTeamMemberId: string|null }
  const [clipboard, setClipboard] = useState(null);
  const [selectedShiftId, setSelectedShiftId] = useState(null);
  const [selectedShiftIds, setSelectedShiftIds] = useState(new Set());
  // Role-warning dialog for paste
  const [pasteWarning, setPasteWarning] = useState(null); // { context, missingRoles, pendingShifts }
  const [pasteConflict, setPasteConflict] = useState(null); // double-book on paste: { payloads, mode, originalShifts, info, single }
  // Undo/redo history. Entry shapes:
  //   { type: 'create', id, data }               undo = delete, redo = re-create
  //   { type: 'update', id, prevData, newData }  undo = restore prev, redo = re-apply
  //   { type: 'delete', id, data }               undo = re-create, redo = delete
  //   { type: 'batch', label, entries: [...] }   undo/redo all, reversed for undo
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const undoStackRef = React.useRef(undoStack);
  const redoStackRef = React.useRef(redoStack);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);
  useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);
  // Last grid cell the mouse touched — the target for Ctrl+V
  const hoverCellRef = useRef(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Scale: hide members without shifts. Starts OFF — you build a schedule by
  // putting shifts on people who don't have one yet, so hiding exactly those
  // people by default hid the point of the page. Role groups already load
  // collapsed, which is what actually keeps 1,000+ members cheap to render.
  // Remembered per device, like the view picker and role filter beside it.
  const [hideEmpty, setHideEmpty] = useState(() => {
    try { return localStorage.getItem('tch-schedule-only-scheduled') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('tch-schedule-only-scheduled', hideEmpty ? '1' : '0'); } catch { /* ignore */ }
  }, [hideEmpty]);

  const weekEnd = addDays(weekStart, spanDays - 1);

  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: appSettings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  // Par staffing plans for coverage comparison (pick which plan to build against)
  const { data: parTemplates = [] } = useParTemplates();
  const { data: allParWindows = [] } = usePars();
  const [parPlanId, setParPlanId] = useState('');
  const locParPlans = useMemo(
    () => parTemplates.filter(t => t.locationId === selectedLocation).sort((a, b) => a.name.localeCompare(b.name)),
    [parTemplates, selectedLocation]
  );
  useEffect(() => {
    if (!locParPlans.some(t => t.id === parPlanId)) {
      const def = locParPlans.find(t => t.isDefault) || locParPlans[0];
      setParPlanId(def ? def.id : '');
    }
  }, [locParPlans, parPlanId]);
  const planWindows = useMemo(() => allParWindows.filter(p => p.templateId === parPlanId), [allParWindows, parPlanId]);
  const parPlanName = locParPlans.find(t => t.id === parPlanId)?.name;

  // recurring availability, mapped per member, for the subtle grid cue
  const { data: availabilityAll = [] } = useAllAvailability();
  const availabilityByMember = useMemo(() => {
    const m = new Map();
    availabilityAll.forEach(a => { if (!m.has(a.teamMemberId)) m.set(a.teamMemberId, []); m.get(a.teamMemberId).push(a); });
    return m;
  }, [availabilityAll]);

  // 24/7: the query window follows the business-day boundary so an overnight
  // week (e.g. day starts 4 AM) includes Sat 1 AM shifts in the prior week
  const dayStartHour = businessDayStartHour(appSettings, selectedLocation);
  const windowStart = new Date(weekStart);
  windowStart.setHours(dayStartHour, 0, 0, 0);
  const windowEnd = addDays(new Date(weekStart), spanDays);
  windowEnd.setHours(dayStartHour, 0, 0, 0);
  const startStr = format(windowStart, "yyyy-MM-dd'T'HH:mm:ss");
  const endStr = format(windowEnd, "yyyy-MM-dd'T'HH:mm:ss");

  const saveMemberMutation = useMutation({
    mutationFn: async (member) => {
      if (member.id) return await base44.entities.TeamMember.update(member.id, member);
      return await base44.entities.TeamMember.create(member);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      setMemberModal({ open: false, member: null });
      toast.success('Team member saved');
    },
    onError: (err) => toast.error(err.message || 'Failed to save team member'),
  });

  // TM search
  useEffect(() => {
    if (!tmSearch.trim()) { setTmSearchResults([]); setShowSearchResults(false); return; }
    const q = tmSearch.toLowerCase();
    const results = teamMembers.filter(tm =>
      tm.status === 'active' && (
        `${tm.firstName} ${tm.lastName}`.toLowerCase().includes(q) ||
        (tm.preferredName && `${tm.preferredName} ${tm.lastName}`.toLowerCase().includes(q)) ||
        (tm.tmNumber && tm.tmNumber.toLowerCase().includes(q))
      )
    ).slice(0, 8);
    setTmSearchResults(results);
    setShowSearchResults(true);
  }, [tmSearch, teamMembers]);

  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearchResults(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Auto-select first location if none chosen yet. Scoped users (location_admin,
  // manager, scheduler) must default to a location they can actually WRITE to —
  // otherwise the schedule silently points at an inaccessible location and every
  // shift create/import trips the shifts RLS policy (has_location_access).
  React.useEffect(() => {
    if (!selectedLocation && locations.length > 0) {
      const active = locations.filter(l => l.status === 'active');
      const scoped = assignedLocationIds.length > 0
        ? active.filter(l => assignedLocationIds.includes(l.id))
        : active;
      const pick = scoped[0] || (assignedLocationIds.length === 0 ? active[0] : null);
      if (pick) setSelectedLocation(pick.id);
    }
  }, [locations, selectedLocation, assignedLocationIds]);

  const { data: shifts = [] } = useQuery({
    queryKey: ['schedule-shifts', startStr, endStr, selectedLocation, spanDays],
    queryFn: async () => {
      const filter = {
        startDateTime: { $gte: startStr, $lt: endStr },
        status: { $ne: 'cancelled' },
        archived: { $ne: true },
      };
      if (selectedLocation) {
        filter.locationId = selectedLocation;
      } else if (assignedLocationIds.length > 0) {
        filter.locationId = { $in: assignedLocationIds };
      }
      // Paginate to fetch beyond the default SDK limit
      const PAGE = 500;
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.Shift.filter(filter, 'startDateTime', PAGE, page * PAGE);
        all = all.concat(batch);
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    placeholderData: [],
  });

  // Roles available at the selected location (keep roles referenced by current shifts so they still render)
  const shiftRoleIds = useMemo(() => shifts.map(s => s.roleId).filter(Boolean), [shifts]);

  // Which roles are actually STAFFED here vs anywhere — derived from team members'
  // role + location assignments. The Paylocity import created every role with no
  // explicit location (= "all locations"), which flooded each room with corporate
  // roles it never uses. So for those, scope to where the role is really worked.
  const { rolesStaffedHere, rolesStaffedAnywhere } = useMemo(() => {
    const here = new Set(), anywhere = new Set();
    teamMembers.forEach(tm => {
      const rids = tm.assignedRoleIds || [];
      if (!rids.length) return;
      const locs = new Set([tm.homeLocationId, ...(tm.assignedLocationIds || [])].filter(Boolean));
      const atHere = locs.has(selectedLocation);
      rids.forEach(rid => { anywhere.add(rid); if (atHere) here.add(rid); });
    });
    return { rolesStaffedHere: here, rolesStaffedAnywhere: anywhere };
  }, [teamMembers, selectedLocation]);

  // Each club orders its positions by relevance/need (location-scoped setting).
  // Held optimistically in pendingRoleOrder so a drag reflows the grid instantly,
  // then cleared once the saved value catches up — no flash back to the old order.
  const savedRoleOrder = useMemo(() => scheduleRoleOrder(appSettings, selectedLocation), [appSettings, selectedLocation]);
  const [pendingRoleOrder, setPendingRoleOrder] = useState(null);
  useEffect(() => { setPendingRoleOrder(null); }, [selectedLocation]);
  useEffect(() => {
    if (pendingRoleOrder && savedRoleOrder.join(',') === pendingRoleOrder.join(',')) setPendingRoleOrder(null);
  }, [savedRoleOrder, pendingRoleOrder]);
  const roleOrder = pendingRoleOrder || savedRoleOrder;

  const visibleRoles = useMemo(() => {
    // roles with a shift OR a par target here are clearly relevant → always render
    const keep = new Set([...shiftRoleIds, ...planWindows.map(w => w.roleId)]);
    const avail = roles.filter(r => {
      if (r.status && r.status !== 'active' && !keep.has(r.id)) return false;
      if (keep.has(r.id)) return true;
      if (r.assignedLocationIds?.length) return r.assignedLocationIds.includes(selectedLocation);
      // no explicit locations: scope to where it's staffed; a role with no staff
      // anywhere stays available everywhere (so brand-new roles aren't hidden).
      if (rolesStaffedAnywhere.has(r.id)) return rolesStaffedHere.has(r.id);
      return true;
    });
    // this club's order wins; anything it doesn't mention keeps display_order
    return sortRolesByOrder(avail, roleOrder);
  }, [roles, selectedLocation, shiftRoleIds, planWindows, rolesStaffedHere, rolesStaffedAnywhere, roleOrder]);

  const saveRoleOrder = useMutation({
    mutationFn: async (ids) => {
      if (!selectedLocation) throw new Error('Pick a location first');
      const existing = appSettings.find(
        s => s.key === 'schedule_role_order' && s.scope === 'location' && s.locationId === selectedLocation
      );
      if (existing) return base44.entities.AppSetting.update(existing.id, { value: ids });
      return base44.entities.AppSetting.create({
        key: 'schedule_role_order', value: ids, scope: 'location', locationId: selectedLocation,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
    onError: (e) => {
      setPendingRoleOrder(null); // snap back to what's actually saved
      toast.error(e?.message || 'Could not save the position order');
    },
  });
  const reorderRoles = (ids) => { setPendingRoleOrder(ids); saveRoleOrder.mutate(ids); };
  const resetRoleOrder = () => { setPendingRoleOrder([]); saveRoleOrder.mutate([]); };

  // Role filter for the grid — hide roles you don't schedule at this location.
  // Saved per location (localStorage) so the curated view sticks between visits.
  const [roleFilter, setRoleFilter] = useState([]); // role ids to SHOW; [] = all
  useEffect(() => {
    try { setRoleFilter(JSON.parse(localStorage.getItem(`tch-schedule-roles-${selectedLocation}`) || '[]') || []); }
    catch { setRoleFilter([]); }
  }, [selectedLocation]);
  const saveRoleFilter = (ids) => {
    setRoleFilter(ids);
    try { localStorage.setItem(`tch-schedule-roles-${selectedLocation}`, JSON.stringify(ids)); } catch { /* ignore */ }
  };
  const toggleRoleFilter = (id) =>
    saveRoleFilter(roleFilter.includes(id) ? roleFilter.filter(r => r !== id) : [...roleFilter, id]);
  // roles actually used here (have a shift or a par target) — the "In use" preset
  const rolesInUse = useMemo(() => {
    const withShift = new Set(shiftRoleIds);
    const withPar = new Set(planWindows.map(w => w.roleId));
    return visibleRoles.filter(r => withShift.has(r.id) || withPar.has(r.id)).map(r => r.id);
  }, [visibleRoles, shiftRoleIds, planWindows]);
  const shownRoles = roleFilter.length ? visibleRoles.filter(r => roleFilter.includes(r.id)) : visibleRoles;

  const pushUndo = useCallback((entry) => {
    setUndoStack(prev => [...prev.slice(-49), entry]);
    setRedoStack([]); // a new action invalidates the redo timeline
  }, []);

  // strip server-managed fields before re-creating a shift from history
  const cleanShiftData = (shift) => {
    const { id: _id, created_date: _cd, updated_date: _ud, createdAt: _ca, updatedAt: _ua, ...rest } = shift;
    return rest;
  };

  const { member: currentMember, isAdmin, canSeeAllLocations } = useCurrentMember();
  // Setting the club's position order is a club-level config call: location_admin+
  // with access to THIS club. app_settings RLS enforces the same bar server-side.
  const canReorderRoles = !!selectedLocation && isAdmin
    && (canSeeAllLocations || assignedLocationIds.includes(selectedLocation));

  const logShiftEvent = async (action, shiftId, details, before = null, after = null) => {
    base44.entities.AuditLog.create({
      actorId: currentMember?.id || 'system',
      actorName: currentMember ? `${currentMember.preferredName || currentMember.firstName} ${currentMember.lastName}` : 'System',
      action,
      entityType: 'Shift',
      entityId: shiftId,
      details,
      beforeValue: before ? JSON.stringify(before) : undefined,
      afterValue: after ? JSON.stringify(after) : undefined,
    });
  };

  const createShift = useMutation({
    mutationFn: (data) => base44.entities.Shift.create(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['schedule-shifts'] });
      const queryKey = ['schedule-shifts', startStr, endStr, selectedLocation];
      const prev = queryClient.getQueryData(queryKey);
      const optimistic = { ...data, id: `optimistic-${Date.now()}` };
      queryClient.setQueryData(queryKey, old => [...(old || []), optimistic]);
      setShiftModal({ open: false, shift: null });
      return { prev, queryKey };
    },
    onSuccess: (created, data) => {
      pushUndo({ type: 'create', id: created.id, data: created });
      const tm = teamMembers.find(t => t.id === data.teamMemberId);
      const tmName = tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Open';
      const role = roles.find(r => r.id === data.roleId);
      logShiftEvent('shift_created', created.id,
        `Created for ${tmName} — ${role?.name || ''} ${data.startDateTime ? format(new Date(data.startDateTime), 'MMM d, h:mm a') : ''}`,
        null,
        { teamMember: tmName, role: role?.name, start: data.startDateTime, end: data.endDateTime, status: data.status }
      );
      toast.success('Shift created');
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.queryKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] }),
  });

  const updateShift = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Shift.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['schedule-shifts'] });
      const queryKey = ['schedule-shifts', startStr, endStr, selectedLocation];
      const prev = queryClient.getQueryData(queryKey);
      const prevShift = (prev || []).find(s => s.id === id);
      if (prevShift) pushUndo({ type: 'update', id, prevData: prevShift, newData: { ...prevShift, ...data } });
      queryClient.setQueryData(queryKey, old =>
        (old || []).map(s => s.id === id ? { ...s, ...data } : s)
      );
      setShiftModal({ open: false, shift: null });
      return { prev, queryKey };
    },
    onSuccess: (_, { id, data }) => {
      const prevShift = undoStack.length > 0 && undoStack[undoStack.length - 1]?.id === id
        ? undoStack[undoStack.length - 1].prevData : null;

      let action = 'shift_updated';
      let details = 'Shift updated';

      if (prevShift) {
        const prevTm = teamMembers.find(t => t.id === prevShift.teamMemberId);
        const newTm = teamMembers.find(t => t.id === data.teamMemberId);
        const prevRole = roles.find(r => r.id === prevShift.roleId);
        const newRole = roles.find(r => r.id === data.roleId);

        if (data.teamMemberId && prevShift.teamMemberId !== data.teamMemberId) {
          action = 'shift_assigned';
          const fromName = prevTm ? `${prevTm.preferredName || prevTm.firstName} ${prevTm.lastName}` : 'Open';
          const toName = newTm ? `${newTm.preferredName || newTm.firstName} ${newTm.lastName}` : 'Open';
          details = `Reassigned from ${fromName} → ${toName}`;
        } else if (data.status === 'published' && prevShift.status !== 'published') {
          action = 'shift_published';
          details = 'Shift published';
        } else {
          const changes = [];
          if (data.roleId && prevShift.roleId !== data.roleId) changes.push(`Role: ${prevRole?.name} → ${newRole?.name}`);
          if (data.startDateTime && prevShift.startDateTime !== data.startDateTime)
            changes.push(`Start: ${format(new Date(prevShift.startDateTime), 'MMM d h:mm a')} → ${format(new Date(data.startDateTime), 'MMM d h:mm a')}`);
          if (changes.length) details = changes.join('; ');
        }

        const before = {
          teamMember: prevTm ? `${prevTm.preferredName || prevTm.firstName} ${prevTm.lastName}` : 'Open',
          role: prevRole?.name, start: prevShift.startDateTime, end: prevShift.endDateTime, status: prevShift.status,
        };
        const after = {
          teamMember: newTm ? `${newTm.preferredName || newTm.firstName} ${newTm.lastName}` : (data.teamMemberId ? data.teamMemberId : 'Open'),
          role: newRole?.name || prevRole?.name, start: data.startDateTime || prevShift.startDateTime,
          end: data.endDateTime || prevShift.endDateTime, status: data.status || prevShift.status,
        };
        logShiftEvent(action, id, details, before, after);
      } else {
        logShiftEvent(action, id, details);
      }
      toast.success('Shift updated');
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.queryKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] }),
  });

  const deleteShift = useMutation({
    mutationFn: (id) => base44.entities.Shift.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['schedule-shifts'] });
      const queryKey = ['schedule-shifts', startStr, endStr, selectedLocation];
      const prev = queryClient.getQueryData(queryKey);
      const prevShift = (prev || []).find(s => s.id === id);
      if (prevShift) pushUndo({ type: 'delete', id, data: prevShift });
      queryClient.setQueryData(queryKey, old => (old || []).filter(s => s.id !== id));
      setShiftModal({ open: false, shift: null });
      setSelectedShiftId(null);
      return { prev, queryKey };
    },
    onSuccess: (_, id) => {
      const prevShift = undoStack.length > 0 && undoStack[undoStack.length - 1]?.id === id
        ? undoStack[undoStack.length - 1].data : null;
      const tm = prevShift ? teamMembers.find(t => t.id === prevShift.teamMemberId) : null;
      const tmName = tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Open';
      logShiftEvent('shift_deleted', id, `Shift deleted (was assigned to ${tmName})`);
      toast.success('Shift deleted');
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.queryKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] }),
  });

  // Track which shifts are currently visible in the filtered grid view
  const [filteredShiftIds, setFilteredShiftIds] = useState(new Set());

  const publishMutation = useMutation({
    mutationFn: async (shiftIds) => {
      const targets = shifts.filter(s => shiftIds.includes(s.id) && s.status === 'draft');
      if (targets.length === 0) return 0;
      // Sequential to avoid rate limits
      for (const s of targets) {
        await base44.entities.Shift.update(s.id, { status: 'published' });
      }
      return targets.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
      toast.success(`${count ?? 0} shift${count !== 1 ? 's' : ''} published`);
    },
  });

  // Understaffed par windows across the visible week (for the publish heads-up)
  const [publishConfirm, setPublishConfirm] = useState(null); // { ids, shortfalls }
  const weekShortfalls = useCallback(() => {
    if (!planWindows.length) return [];
    const out = [];
    const days = Array.from({ length: spanDays }, (_, i) => addDays(weekStart, i));
    roles.forEach(role => days.forEach(day => {
      roleDayCoverage(planWindows, shifts, role.id, day, dayStartHour, selectedLocation)
        .filter(c => c.status === 'short')
        .forEach(c => out.push({ day, roleName: role.name, from: c.start, to: c.end, min: c.min, required: c.required }));
    }));
    return out;
  }, [planWindows, spanDays, weekStart, roles, shifts, dayStartHour, selectedLocation]);

  // publish, but pause on a par shortfall so the scheduler can confirm
  const guardedPublish = (ids) => {
    if (!ids.length) return;
    const shortfalls = weekShortfalls();
    if (shortfalls.length) setPublishConfirm({ ids, shortfalls });
    else publishMutation.mutate(ids);
  };

  const handleSave = (data) => {
    // Check for overlapping shifts for the same team member
    if (data.teamMemberId) {
      const newStart = new Date(data.startDateTime);
      const newEnd = new Date(data.endDateTime);
      const editingId = shiftModal.shift?.id;

      const overlap = shifts.find(s => {
        if (s.id === editingId) return false; // skip the shift being edited
        if (s.teamMemberId !== data.teamMemberId) return false;
        if (s.status === 'cancelled') return false;
        const sStart = new Date(s.startDateTime);
        const sEnd = new Date(s.endDateTime);
        return newStart < sEnd && newEnd > sStart;
      });

      if (overlap) {
        const tm = teamMembers.find(t => t.id === data.teamMemberId);
        const name = tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'This team member';
        toast.error(`${name} already has an overlapping shift during this time.`);
        return;
      }
    }

    if (shiftModal.shift?.id) {
      const existingShift = shifts.find(s => s.id === shiftModal.shift.id);
      const wasPublished = existingShift?.status === 'published';
      const teamMemberRemoved = wasPublished && existingShift?.teamMemberId && !data.teamMemberId;

      const finalData = { ...data };
      // Editing a published shift reverts it to draft so changes must be re-published
      if (wasPublished) {
        finalData.status = 'draft';
        toast.info('Shift unpublished — re-publish when ready');
      }
      if (teamMemberRemoved) {
        // Shift becomes an open shift when team member is removed
        finalData.teamMemberId = null;
        finalData.shiftType = 'open';
        finalData.coverageStatus = 'open';
      }
      updateShift.mutate({ id: shiftModal.shift.id, data: finalData });
    } else {
      createShift.mutate(data);
    }
  };

  const handleAddShift = ({ date, roleId, teamMemberId, startHour }) => {
    const start = new Date(date);
    start.setHours(startHour != null ? startHour : 9, 0, 0, 0);
    // default 8-hour shift; date math carries it past midnight correctly
    const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
    setShiftModal({
      open: true,
      shift: {
        locationId: selectedLocation || '',
        roleId: roleId || '',
        teamMemberId: teamMemberId || '',
        startDateTime: format(start, "yyyy-MM-dd'T'HH:mm"),
        endDateTime: format(end, "yyyy-MM-dd'T'HH:mm"),
      },
    });
  };

  // ── Clipboard operations ──────────────────────────────────────────────────

  const handleCopy = useCallback((shift) => {
    setClipboard({ shifts: [shift], mode: 'copy', sourceTeamMemberId: shift.teamMemberId || null });
    setSelectedShiftId(shift.id);
    toast.success('Shift copied');
  }, []);

  const handleCut = useCallback((shift) => {
    setClipboard({ shifts: [shift], mode: 'cut', sourceTeamMemberId: shift.teamMemberId || null });
    setSelectedShiftId(shift.id);
    toast.success('Shift cut — click a cell to paste');
  }, []);

  // Copy all shifts for a team member (from the current week's visible shifts)
  const handleCopyMemberShifts = useCallback((teamMemberId) => {
    const memberShifts = shifts.filter(s => s.teamMemberId === teamMemberId);
    if (memberShifts.length === 0) { toast.info('No shifts this week to copy'); return; }
    setClipboard({ shifts: memberShifts, mode: 'copy', sourceTeamMemberId: teamMemberId });
    toast.success(`${memberShifts.length} shift${memberShifts.length > 1 ? 's' : ''} copied`);
  }, [shifts]);

  // Execute the actual paste (after any role-warning confirmation).
  // Batched for speed, and the whole paste (plus a cut's removals) is one
  // undoable step.
  // Build the shift row(s) a paste would create (without writing them)
  const buildPastePayloads = useCallback((context, shiftsToPaste) => {
    const targetTmId = context.teamMemberId || shiftsToPaste[0]?.teamMemberId || '';
    if (shiftsToPaste.length === 1) {
      // Single shift paste: land on the provided date, keep the time of day
      const shift = shiftsToPaste[0];
      const start = new Date(context.date);
      start.setHours(new Date(shift.startDateTime).getHours(), new Date(shift.startDateTime).getMinutes(), 0, 0);
      const durationMs = new Date(shift.endDateTime) - new Date(shift.startDateTime);
      const end = new Date(start.getTime() + durationMs);
      return [{
        ...cleanShiftData(shift),
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
        roleId: context.roleId || shift.roleId,
        teamMemberId: targetTmId,
        coverageStatus: 'covered',
        recentChangeFlag: false,
        status: 'draft',
      }];
    }
    // Multi-shift paste: preserve each shift's day and time, reassign member
    return shiftsToPaste.map(shift => ({
      ...cleanShiftData(shift),
      teamMemberId: targetTmId,
      coverageStatus: 'covered',
      recentChangeFlag: false,
      status: 'draft',
    }));
  }, []);

  const writePastePayloads = useCallback(async (payloads, mode, originalShifts) => {
    const created = await base44.entities.Shift.bulkCreate(payloads);
    const undoEntries = created.map(c => ({ type: 'create', id: c.id, data: c }));

    if (mode === 'cut') {
      const results = await Promise.all(originalShifts.map(s =>
        base44.entities.Shift.delete(s.id).then(() => s).catch(() => null)
      ));
      results.filter(Boolean).forEach(s => undoEntries.push({ type: 'delete', id: s.id, data: s }));
      setClipboard(null);
    }

    pushUndo(undoEntries.length === 1 ? undoEntries[0] : { type: 'batch', label: 'paste', entries: undoEntries });

    queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    const n = payloads.length;
    toast.success(mode === 'cut'
      ? `${n} shift${n > 1 ? 's' : ''} moved`
      : `${n} shift${n > 1 ? 's' : ''} pasted`
    );
  }, [queryClient, pushUndo]);

  const executePaste = useCallback(async (context, shiftsToPaste, mode, originalShifts) => {
    await writePastePayloads(buildPastePayloads(context, shiftsToPaste), mode, originalShifts);
  }, [buildPastePayloads, writePastePayloads]);

  const handlePaste = useCallback(async (context) => {
    if (!clipboard) return;
    const { shifts: clipShifts, mode, sourceTeamMemberId } = clipboard;
    const targetTmId = context.teamMemberId;

    // Check role compatibility only when pasting to a different team member
    if (targetTmId && targetTmId !== sourceTeamMemberId) {
      const targetTm = teamMembers.find(t => t.id === targetTmId);
      const assignedRoleIds = targetTm?.assignedRoleIds || [];
      const neededRoleIds = [...new Set(clipShifts.map(s => s.roleId).filter(Boolean))];
      const missingRoles = neededRoleIds
        .filter(rid => !assignedRoleIds.includes(rid))
        .map(rid => roles.find(r => r.id === rid))
        .filter(Boolean);

      if (missingRoles.length > 0) {
        const targetName = targetTm
          ? `${targetTm.preferredName || targetTm.firstName} ${targetTm.lastName}`
          : 'This team member';
        setPasteWarning({ context, missingRoles, pendingShifts: clipShifts, targetName, mode, originalShifts: clipShifts });
        return;
      }
    }

    // Double-book check: would the assigned member already be scheduled then?
    const payloads = buildPastePayloads(context, clipShifts);
    const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
    const cutIds = mode === 'cut' ? new Set(clipShifts.map(s => s.id)) : new Set();
    const conflicts = [];
    payloads.forEach(p => {
      if (!p.teamMemberId) return; // open shift — nothing to double-book
      const pS = new Date(p.startDateTime), pE = new Date(p.endDateTime);
      const clash = shifts.find(s => s.teamMemberId === p.teamMemberId && s.status !== 'cancelled'
        && !cutIds.has(s.id) && overlaps(pS, pE, new Date(s.startDateTime), new Date(s.endDateTime)));
      if (clash) conflicts.push({ payload: p, existing: clash });
    });
    if (conflicts.length) {
      const info = conflicts.map(c => {
        const m = teamMembers.find(t => t.id === c.payload.teamMemberId);
        const role = roles.find(r => r.id === c.existing.roleId);
        return {
          name: m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'This team member',
          when: `${format(new Date(c.existing.startDateTime), 'EEE MMM d, h:mm a')} – ${format(new Date(c.existing.endDateTime), 'h:mm a')}`,
          roleName: role?.name || '',
        };
      });
      setPasteConflict({ payloads, mode, originalShifts: clipShifts, info, single: payloads.length === 1 });
      return;
    }
    await writePastePayloads(payloads, mode, clipShifts);
  }, [clipboard, teamMembers, roles, shifts, buildPastePayloads, writePastePayloads]);

  const handlePublishToggle = useCallback((shift, revert = false) => {
    updateShift.mutate({ id: shift.id, data: { status: revert ? 'draft' : 'published' } });
  }, [updateShift]);

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleDrop = useCallback(async (shiftId, context, opts = {}) => {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;

    const start = new Date(context.day);
    start.setHours(new Date(shift.startDateTime).getHours(), new Date(shift.startDateTime).getMinutes(), 0, 0);
    const durationMs = new Date(shift.endDateTime) - new Date(shift.startDateTime);
    const end = new Date(start.getTime() + durationMs);

    if (opts.copy) {
      // Alt-drag: duplicate the shift at the drop target (as a draft)
      const created = await base44.entities.Shift.create({
        ...cleanShiftData(shift),
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
        roleId: context.roleId || shift.roleId,
        teamMemberId: context.teamMemberId !== undefined ? context.teamMemberId : shift.teamMemberId,
        coverageStatus: 'covered',
        recentChangeFlag: false,
        status: 'draft',
      });
      pushUndo({ type: 'create', id: created.id, data: created });
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
      toast.success('Shift copied');
      return;
    }

    const updates = {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
    };
    if (context.roleId) updates.roleId = context.roleId;
    if (context.teamMemberId !== undefined) updates.teamMemberId = context.teamMemberId;
    // Keep published shifts published after drag-and-drop
    if (shift.status === 'published') updates.status = 'published';

    await base44.entities.Shift.update(shiftId, updates);
    pushUndo({ type: 'update', id: shiftId, prevData: shift, newData: { ...shift, ...updates } });
    queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    toast.success('Shift moved');
  }, [shifts, queryClient, pushUndo]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  // Apply one history entry in a direction; returns the mirrored entry for the
  // opposite stack (ids change when an undone delete re-creates the row)
  const applyEntry = useCallback(async function apply(entry, dir) {
    if (entry.type === 'batch') {
      const list = dir === 'undo' ? [...entry.entries].reverse() : entry.entries;
      const out = [];
      for (const e of list) out.push(await apply(e, dir));
      return { ...entry, entries: dir === 'undo' ? out.reverse() : out };
    }
    if (entry.type === 'create') {
      if (dir === 'undo') { await base44.entities.Shift.delete(entry.id); return entry; }
      const created = await base44.entities.Shift.create(cleanShiftData(entry.data));
      return { ...entry, id: created.id, data: created };
    }
    if (entry.type === 'update') {
      await base44.entities.Shift.update(
        entry.id,
        cleanShiftData(dir === 'undo' ? entry.prevData : entry.newData)
      );
      return entry;
    }
    if (entry.type === 'delete') {
      if (dir === 'undo') {
        const created = await base44.entities.Shift.create(cleanShiftData(entry.data));
        return { ...entry, id: created.id, data: created };
      }
      await base44.entities.Shift.delete(entry.id);
      return entry;
    }
    return entry;
  }, []); // eslint-disable-line

  const handleUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) { toast.info('Nothing to undo'); return; }
    const entry = stack[stack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    try {
      const mirrored = await applyEntry(entry, 'undo');
      setRedoStack(prev => [...prev.slice(-49), mirrored]);
      toast.success(entry.type === 'batch' ? `Undone (${entry.entries.length} changes)` : 'Undone');
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    } catch {
      toast.error('Could not undo — the shift may have already been changed or deleted.');
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    }
  }, [applyEntry, queryClient]);

  const handleRedo = useCallback(async () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) { toast.info('Nothing to redo'); return; }
    const entry = stack[stack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    try {
      const mirrored = await applyEntry(entry, 'redo');
      setUndoStack(prev => [...prev.slice(-49), mirrored]);
      toast.success(entry.type === 'batch' ? `Redone (${entry.entries.length} changes)` : 'Redone');
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    } catch {
      toast.error('Could not redo.');
      queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
    }
  }, [applyEntry, queryClient]);

  useEffect(() => {
    const onKey = (e) => {
      // Ignore when focused inside an input/textarea/select/dialog
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      const inDialog = document.activeElement?.closest('[role="dialog"]');
      if (inDialog) return;
      // Also ignore contenteditable
      if (document.activeElement?.isContentEditable) return;

      const selectedShift = selectedShiftId ? shifts.find(s => s.id === selectedShiftId) : null;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen(v => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedShiftIds(new Set(shifts.map(s => s.id)));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (selectedShiftIds.size > 1) {
          // Multi-copy: store all selected shifts
          const multiShifts = shifts.filter(s => selectedShiftIds.has(s.id));
          const srcTmId = multiShifts[0]?.teamMemberId || null;
          setClipboard({ shifts: multiShifts, mode: 'copy', sourceTeamMemberId: srcTmId });
          toast.success(`${multiShifts.length} shifts copied`);
        } else if (selectedShift) {
          handleCopy(selectedShift);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        if (selectedShiftIds.size > 1) {
          const multiShifts = shifts.filter(s => selectedShiftIds.has(s.id));
          const srcTmId = multiShifts[0]?.teamMemberId || null;
          setClipboard({ shifts: multiShifts, mode: 'cut', sourceTeamMemberId: srcTmId });
          toast.success(`${multiShifts.length} shifts cut — click a team member row to paste`);
        } else if (selectedShift) {
          handleCut(selectedShift);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard) {
          e.preventDefault();
          // paste lands in the cell the mouse is over; fall back to the source cell
          const target = hoverCellRef.current;
          const s = clipboard.shifts[0];
          handlePaste(target || { date: new Date(s.startDateTime), roleId: s.roleId, teamMemberId: s.teamMemberId });
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedShiftIds.size > 1) {
          const targets = shifts.filter(s => selectedShiftIds.has(s.id));
          const total = targets.length;
          let done = 0;
          const toastId = `bulk-delete-${Date.now()}`;
          toast.loading(`Deleting 0 / ${total} shifts…`, { id: toastId, duration: Infinity });
          (async () => {
            const deleted = [];
            const BATCH = 10;
            for (let i = 0; i < targets.length; i += BATCH) {
              const chunk = targets.slice(i, i + BATCH);
              const results = await Promise.all(chunk.map(s =>
                base44.entities.Shift.delete(s.id).then(() => s).catch(() => null)
              ));
              deleted.push(...results.filter(Boolean));
              done += chunk.length;
              toast.loading(`Deleting ${Math.min(done, total)} / ${total} shifts…`, { id: toastId, duration: Infinity });
            }
            if (deleted.length) {
              pushUndo({
                type: 'batch',
                label: 'bulk delete',
                entries: deleted.map(s => ({ type: 'delete', id: s.id, data: s })),
              });
            }
            queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
            toast.success(`${deleted.length} shifts deleted — Ctrl+Z to undo`, { id: toastId, duration: 3000 });
            setSelectedShiftIds(new Set());
            setSelectedShiftId(null);
          })();
        } else if (selectedShift && !e.metaKey) {
          deleteShift.mutate(selectedShift.id);
        }
      } else if (e.key === 'Escape') {
        setSelectedShiftId(null);
        setSelectedShiftIds(new Set());
        setClipboard(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedShiftId, selectedShiftIds, shifts, clipboard, handleCopy, handleCut, handlePaste, deleteShift, handleUndo, handleRedo, pushUndo, queryClient]); // eslint-disable-line

  const draftCount = shifts.filter(s => s.status === 'draft').length;
  const filteredDraftCount = shifts.filter(s => s.status === 'draft' && filteredShiftIds.has(s.id)).length;
  const selectedDraftCount = shifts.filter(s => s.status === 'draft' && (selectedShiftIds.has(s.id) || s.id === selectedShiftId)).length;

  return (
    <div className="max-w-full flex flex-col" style={{ height: 'calc(100dvh - 112px)', minHeight: 0 }} onClick={() => { setSelectedShiftId(null); setSelectedShiftIds(new Set()); }}>
      <div className="flex-shrink-0">
      <PageHeader title="Schedule Builder" subtitle={`${format(weekStart, 'MMM d')} – ${format(weekEnd, spanDays === 1 ? 'MMM d, yyyy' : 'MMM d, yyyy')}`}>
        {clipboard && (
          <Badge variant="secondary" className="gap-1.5 text-xs bg-primary/10 text-primary border-primary/20">
            <Clipboard className="w-3 h-3" />
            {clipboard.shifts.length > 1
              ? `${clipboard.mode === 'cut' ? 'Cut' : 'Copied'} ${clipboard.shifts.length} shifts — click team member row to paste`
              : `${clipboard.mode === 'cut' ? 'Cut' : 'Copied'} — click cell to paste`
            }
            <button className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setClipboard(null)}>✕</button>
          </Badge>
        )}
        <PublishButton
          draftCount={draftCount}
          filteredDraftCount={filteredDraftCount}
          selectedDraftCount={selectedDraftCount}
          isPending={publishMutation.isPending}
          onPublishAll={() => guardedPublish(shifts.filter(s => s.status === 'draft').map(s => s.id))}
          onPublishFiltered={() => guardedPublish([...filteredShiftIds].filter(id => shifts.find(s => s.id === id && s.status === 'draft')))}
          onPublishSelected={() => {
            const ids = [...selectedShiftIds];
            if (selectedShiftId && !selectedShiftIds.has(selectedShiftId)) ids.push(selectedShiftId);
            guardedPublish(ids.filter(id => shifts.find(s => s.id === id && s.status === 'draft')));
          }}
        />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportTemplateModal(true)}>
          <FileText className="w-4 h-4" /> Import Template
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportModal(true)}>
          <Upload className="w-4 h-4" /> Import Paylocity
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShiftModal({ open: true, shift: null })}>
          <Plus className="w-4 h-4" /> Add Shift
        </Button>
      </PageHeader>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4 flex-shrink-0">
        <LocationSelector
          value={selectedLocation}
          onChange={setSelectedLocation}
          className="w-[200px]"
          showAll={false}
          allowedIds={assignedLocationIds.length > 0 ? assignedLocationIds : undefined}
        />
        <WeekSelector weekStart={weekStart} setWeekStart={setWeekStart} spanDays={spanDays} />
        <ViewDropdown value={viewKey} onChange={setViewKey} />

        <RolePanel
          roles={visibleRoles}
          roleFilter={roleFilter}
          onSaveFilter={saveRoleFilter}
          onToggleFilter={toggleRoleFilter}
          rolesInUse={rolesInUse}
          locationName={(selectedLocation && locations.find(l => l.id === selectedLocation)?.name) || ''}
          canReorder={canReorderRoles}
          onReorder={reorderRoles}
          onResetOrder={resetRoleOrder}
          hasCustomOrder={roleOrder.length > 0}
          isSavingOrder={saveRoleOrder.isPending}
        />
        {locParPlans.length > 0 && (
          <div className="flex items-center gap-1.5" title="Staffing plan to check coverage against">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <Select value={parPlanId} onValueChange={setParPlanId}>
              <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue placeholder="Par plan" /></SelectTrigger>
              <SelectContent>
                {locParPlans.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
          onClick={(e) => e.stopPropagation()}
          title="Hide team members with no shifts in this view"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          Only scheduled
        </label>
        {/* TM Search */}
        <div className="relative" ref={searchRef} onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-transparent text-sm shadow-sm w-48">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
              placeholder="Find team member…"
              value={tmSearch}
              onChange={e => setTmSearch(e.target.value)}
              onFocus={() => tmSearchResults.length > 0 && setShowSearchResults(true)}
            />
            {tmSearch && <button onClick={() => { setTmSearch(''); setShowSearchResults(false); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
          </div>
          {showSearchResults && tmSearchResults.length > 0 && (
            <div className="absolute top-10 left-0 z-50 bg-popover border border-border rounded-lg shadow-lg w-56 py-1">
              {tmSearchResults.map(tm => (
                <button
                  key={tm.id}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors"
                  onMouseDown={e => {
                    e.preventDefault();
                    setShowSearchResults(false);
                    setTmSearch('');
                    scrollToTmRef.current?.(tm.id);
                  }}
                >
                  <span className="font-medium">{tm.preferredName || tm.firstName} {tm.lastName}</span>
                  {tm.tmNumber && <span className="text-muted-foreground ml-auto">#{tm.tmNumber}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            title="Keyboard shortcuts (?)"
            onClick={(e) => { e.stopPropagation(); setShortcutsOpen(true); }}
            className="w-6 h-6 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
          >
            ?
          </button>
          <Badge variant="outline" className="text-xs">{shifts.length} shifts</Badge>
          {draftCount > 0 && (
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {draftCount} drafts
            </Badge>
          )}
          {selectedShiftIds.size > 1 && (
            <Badge variant="outline" className="text-xs text-primary border-primary/40">
              {selectedShiftIds.size} selected · Del to delete
            </Badge>
          )}
          {selectedShiftIds.size <= 1 && selectedShiftId && (
            <Badge variant="outline" className="text-xs text-primary border-primary/40">
              1 selected · Del to delete
            </Badge>
          )}
        </div>
      </div>

      </div>{/* end sticky header */}

      {/* Grid / Summary */}
      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 min-h-0">
        {viewMode === 'timeline' ? (
          <DayTimeline
            date={weekStart}
            shifts={shifts}
            roles={shownRoles}
            teamMembers={teamMembers}
            dayStartHour={dayStartHour}
            onShiftClick={(shift) => setShiftModal({ open: true, shift })}
          />
        ) : viewMode === 'summary' ? (
          <DayViewSummary
            date={weekStart}
            shifts={shifts}
            roles={shownRoles}
            teamMembers={teamMembers}
            dayStartHour={dayStartHour}
            parWindows={planWindows}
            planName={parPlanName}
            locationId={selectedLocation}
            onShiftClick={(shift) => setShiftModal({ open: true, shift })}
          />
        ) : (
        <ScheduleGrid
          weekStart={weekStart}
          shifts={shifts}
          roles={shownRoles}
          teamMembers={teamMembers}
          locations={locations}
          viewMode={viewMode}
          spanDays={spanDays}
          parWindows={planWindows}
          availabilityByMember={availabilityByMember}
          onShiftClick={(shift) => setShiftModal({ open: true, shift })}
          onAddShift={handleAddShift}
          selectedLocation={selectedLocation}
          selectedShiftId={selectedShiftId}
          onShiftSelect={setSelectedShiftId}
          selectedShiftIds={selectedShiftIds}
          onShiftMultiSelect={(id) => {
            setSelectedShiftIds(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onRangeSelect={(ids) => {
            setSelectedShiftIds(prev => {
              const next = new Set(prev);
              ids.forEach(id => next.add(id));
              return next;
            });
          }}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onDelete={(id) => deleteShift.mutate(id)}
          onPublish={handlePublishToggle}
          clipboard={clipboard}
          onDrop={handleDrop}
          onCopyMemberShifts={handleCopyMemberShifts}
          onFilteredShiftsChange={setFilteredShiftIds}
          onRegisterScrollTo={(fn) => { scrollToTmRef.current = fn; }}
          onTeamMemberClick={(tm) => setMemberModal({ open: true, member: tm })}
          onHoverCell={(ctx) => { hoverCellRef.current = ctx; }}
          dayStartHour={dayStartHour}
          hideEmptyRows={hideEmpty}
        />
        )}
      </div>

      <AlertDialog open={!!publishConfirm} onOpenChange={(o) => !o && setPublishConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish with understaffed windows?</AlertDialogTitle>
            <AlertDialogDescription>
              This week has {publishConfirm?.shortfalls.length} par window{publishConfirm?.shortfalls.length !== 1 ? 's' : ''} below target{parPlanName ? ` for "${parPlanName}"` : ''}. You can still publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-52 overflow-y-auto text-xs space-y-1">
            {publishConfirm?.shortfalls.slice(0, 12).map((s, i) => (
              <div key={i} className="flex justify-between gap-2 px-2 py-1 rounded bg-red-50 dark:bg-red-950/20">
                <span>{format(s.day, 'EEE')} · {s.roleName}</span>
                <span className="tabular-nums text-red-600 dark:text-red-400">{format(s.from, 'h:mm a')}–{format(s.to, 'h:mm a')} · {s.min}/{s.required}</span>
              </div>
            ))}
            {publishConfirm && publishConfirm.shortfalls.length > 12 && (
              <p className="text-muted-foreground px-2">+{publishConfirm.shortfalls.length - 12} more…</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { publishMutation.mutate(publishConfirm.ids); setPublishConfirm(null); }}>Publish anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShiftModal
        open={shiftModal.open}
        onClose={() => setShiftModal({ open: false, shift: null })}
        shift={shiftModal.shift}
        locations={locations}
        roles={visibleRoles}
        teamMembers={teamMembers}
        shifts={shifts}
        onSave={handleSave}
        onDelete={(id) => deleteShift.mutate(id)}
      />

      <PasteRoleWarningDialog
        open={!!pasteWarning}
        onClose={() => setPasteWarning(null)}
        missingRoles={pasteWarning?.missingRoles || []}
        targetName={pasteWarning?.targetName || ''}
        onConfirm={async () => {
          if (pasteWarning) {
            const { context, pendingShifts, mode, originalShifts } = pasteWarning;
            setPasteWarning(null);
            await executePaste(context, pendingShifts, mode, originalShifts);
          }
        }}
      />

      <PasteConflictDialog
        open={!!pasteConflict}
        onClose={() => setPasteConflict(null)}
        info={pasteConflict?.info || []}
        single={pasteConflict?.single}
        onCreateOpen={() => {
          if (!pasteConflict) return;
          const openPayloads = pasteConflict.payloads.map(p => ({ ...p, teamMemberId: null, shiftType: 'open' }));
          writePastePayloads(openPayloads, pasteConflict.mode, pasteConflict.originalShifts);
          setPasteConflict(null);
        }}
        onScheduleAnyway={() => {
          if (!pasteConflict) return;
          writePastePayloads(pasteConflict.payloads, pasteConflict.mode, pasteConflict.originalShifts);
          setPasteConflict(null);
        }}
        onAssignOther={() => {
          if (!pasteConflict) return;
          const p = pasteConflict.payloads[0];
          setPasteConflict(null);
          setShiftModal({ open: true, shift: {
            locationId: p.locationId || selectedLocation || '',
            roleId: p.roleId || '',
            teamMemberId: '',
            startDateTime: format(new Date(p.startDateTime), "yyyy-MM-dd'T'HH:mm"),
            endDateTime: format(new Date(p.endDateTime), "yyyy-MM-dd'T'HH:mm"),
          } });
        }}
      />

      <ImportPaylocityModal
        open={importModal}
        onClose={() => setImportModal(false)}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
          setImportModal(false);
        }}
      />

      <ImportTemplateModal
        open={importTemplateModal}
        onClose={() => setImportTemplateModal(false)}
        weekStart={weekStart}
        selectedLocation={selectedLocation}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['schedule-shifts'] });
          setImportTemplateModal(false);
        }}
      />

      <TeamMemberModal
        open={memberModal.open}
        onClose={() => setMemberModal({ open: false, member: null })}
        member={memberModal.member}
        locations={locations}
        roles={roles}
        existingMembers={teamMembers}
        onSave={(form) => saveMemberMutation.mutate(form)}
      />

      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
              <button className="text-muted-foreground hover:text-foreground text-sm" onClick={() => setShortcutsOpen(false)}>✕</button>
            </div>
            <div className="space-y-1.5 text-xs">
              {[
                ['Click', 'Select / open a shift'],
                ['Ctrl + Click', 'Add or remove from selection'],
                ['Shift + Click', 'Select a range'],
                ['Ctrl + A', 'Select all shifts'],
                ['Ctrl + C / X', 'Copy / cut selection'],
                ['Ctrl + V', 'Paste into the cell under the mouse'],
                ['Delete', 'Delete selection (drafts)'],
                ['Ctrl + Z', 'Undo'],
                ['Ctrl + Shift + Z / Ctrl + Y', 'Redo'],
                ['Drag', 'Move a shift'],
                ['Alt + Drag', 'Copy a shift'],
                ['Right-click a name', 'Copy all their shifts this week'],
                ['Escape', 'Clear selection & clipboard'],
                ['?', 'Toggle this panel'],
              ].map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-1 border-b border-border/60 last:border-0">
                  <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] whitespace-nowrap">{keys}</kbd>
                  <span className="text-muted-foreground text-right">{what}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Schedule() {
  const { isTeamMember, assignedLocationIds } = useCurrentMember();
  if (isTeamMember) return <ViewSchedule assignedLocationIds={assignedLocationIds} />;
  return <ScheduleBuilder assignedLocationIds={assignedLocationIds} />;
}
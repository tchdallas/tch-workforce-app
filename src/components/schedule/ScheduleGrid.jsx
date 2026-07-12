import React, { useState, useEffect, useRef, useCallback } from 'react';
import { format, addDays, isSameDay } from 'date-fns';
import { cn, businessDayOf } from '@/lib/utils';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import ShiftCard from './ShiftCard';
import { roleDayCoverage } from '@/lib/parCoverage';

export default function ScheduleGrid({
  weekStart, shifts, roles, teamMembers, locations, viewMode,
  parWindows = [],
  onShiftClick, onAddShift, selectedLocation,
  selectedShiftId, onShiftSelect,
  selectedShiftIds, onShiftMultiSelect,
  onCopy, onCut, onPaste, onDelete, onPublish, clipboard,
  onDrop, onCopyMemberShifts, onFilteredShiftsChange,
  onRangeSelect,
  onRegisterScrollTo,
  onTeamMemberClick,
  onHoverCell,
  spanDays = 7,
  readOnly = false,
  dayStartHour = 0, // 24/7 grouping: shifts starting before this hour belong to the previous day
  hideEmptyRows = false, // scale: only show members who have shifts in this window
}) {
  const rowRefs = useRef({}); // tmId -> array of DOM elements (one per role section)
  const [dragOverCell, setDragOverCell] = useState(null);
  const [collapsedRoles, setCollapsedRoles] = useState(new Set());
  const [rolesInitialized, setRolesInitialized] = useState(false);

  useEffect(() => {
    if (!rolesInitialized && roles.length > 0) {
      setCollapsedRoles(new Set(roles.map(r => r.id)));
      setRolesInitialized(true);
    }
  }, [roles, rolesInitialized]);
  const [tmContextMenu, setTmContextMenu] = useState(null); // { x, y, teamMemberId }
  const [lastSelectedId, setLastSelectedId] = useState(null); // for shift+click range

  useEffect(() => {
    if (!onRegisterScrollTo) return;
    onRegisterScrollTo((tmId) => {
      // Expand all collapsed roles that contain this TM
      const tm = teamMembers.find(t => t.id === tmId);
      const roleIdsForTm = roles.filter(r =>
        tm?.assignedRoleIds?.includes(r.id) ||
        shifts.some(s => s.roleId === r.id && s.teamMemberId === tmId)
      ).map(r => r.id);

      if (roleIdsForTm.length > 0) {
        setCollapsedRoles(prev => {
          const next = new Set(prev);
          roleIdsForTm.forEach(id => next.delete(id));
          return next;
        });
      }

      // After state update, scroll to first occurrence
      setTimeout(() => {
        const els = rowRefs.current[tmId];
        const first = Array.isArray(els) ? els[0] : els;
        first?.scrollIntoView({ behavior: 'instant', block: 'center' });
      }, 50);
    });
  }, [onRegisterScrollTo, roles, teamMembers]);

  const toggleRole = (roleId) => {
    setCollapsedRoles(prev => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const days = Array.from({ length: spanDays }, (_, i) => addDays(weekStart, i));

  // For many days, use a more compact header
  const isCompact = spanDays > 7;
  const totalCols = spanDays + 1; // label col + day cols

  const onBusinessDay = (s, day) => businessDayOf(s.startDateTime, dayStartHour) === format(day, 'yyyy-MM-dd');

  const getShiftsForDay = (day, filterFn) =>
    shifts.filter(s => onBusinessDay(s, day) && (filterFn ? filterFn(s) : true));

  // Include active roles, plus any role referenced by open shifts (even if archived)
  const openShiftRoleIds = new Set(shifts.filter(s => !s.teamMemberId && s.roleId).map(s => s.roleId));
  const filteredRoles = roles.filter(r => r.status === 'active' || openShiftRoleIds.has(r.id));
  const locationMembers = teamMembers.filter(tm => {
    if (tm.status !== 'active') return false;
    if (selectedLocation && selectedLocation !== 'all') {
      return tm.homeLocationId === selectedLocation || tm.assignedLocationIds?.includes(selectedLocation);
    }
    return true;
  });
  // At 1,000+ members, rendering a row per person is unusable — optionally
  // show only people who actually have shifts in the current window
  const scheduledMemberIds = new Set(shifts.map(s => s.teamMemberId).filter(Boolean));
  const filteredTeamMembers = hideEmptyRows
    ? locationMembers.filter(tm => scheduledMemberIds.has(tm.id))
    : locationMembers;

  // Report which shifts are currently visible (for "Publish Filtered" feature)
  useEffect(() => {
    if (!onFilteredShiftsChange) return;
    const visibleIds = new Set();
    shifts.forEach(shift => {
      if (!shift.teamMemberId) {
        // Open/unassigned shifts — always visible
        visibleIds.add(shift.id);
        return;
      }
      const tm = teamMembers.find(t => t.id === shift.teamMemberId);
      if (!tm || tm.status !== 'active') return;
      if (selectedLocation && selectedLocation !== 'all') {
        if (tm.homeLocationId !== selectedLocation && !tm.assignedLocationIds?.includes(selectedLocation)) return;
      }
      visibleIds.add(shift.id);
    });
    onFilteredShiftsChange(visibleIds);
  }, [shifts, teamMembers, selectedLocation, onFilteredShiftsChange]);

  const getTeamMember = (id) => teamMembers.find(tm => tm.id === id);
  const getRole = (id) => roles.find(r => r.id === id);
  const getLocation = (id) => locations.find(l => l.id === id);

  const handleDragOver = (e, cellKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; // Alt-drag duplicates
    setDragOverCell(cellKey);
  };

  // TM row label context menu
  const handleTmContextMenu = (e, teamMemberId) => {
    e.preventDefault();
    setTmContextMenu({ x: e.clientX, y: e.clientY, teamMemberId });
  };

  const closeTmContextMenu = () => setTmContextMenu(null);

  // Close on outside click
  useEffect(() => {
    if (!tmContextMenu) return;
    const close = () => closeTmContextMenu();
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tmContextMenu]);

  const handleDrop = (e, context) => {
    e.preventDefault();
    setDragOverCell(null);
    const shiftId = e.dataTransfer.getData('shiftId');
    if (shiftId && onDrop) onDrop(shiftId, context, { copy: e.altKey });
  };

  const shiftCardProps = (shift, visibleShiftIds) => ({
    role: getRole(shift.roleId),
    teamMember: getTeamMember(shift.teamMemberId),
    location: getLocation(shift.locationId),
    readOnly,
    onClick: readOnly ? undefined : (s, e) => {
      if (e?.shiftKey && lastSelectedId && visibleShiftIds) {
        // Shift+click: select range between lastSelectedId and this shift
        const ids = visibleShiftIds;
        const fromIdx = ids.indexOf(lastSelectedId);
        const toIdx = ids.indexOf(s.id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const rangeIds = ids.slice(lo, hi + 1);
          onRangeSelect?.(rangeIds);
          return;
        }
      }
      if (e?.ctrlKey || e?.metaKey) {
        onShiftMultiSelect?.(s.id);
        setLastSelectedId(s.id);
      } else {
        setLastSelectedId(s.id);
        onShiftSelect(s.id);
        onShiftClick(s);
      }
    },
    selected: !readOnly && (selectedShiftId === shift.id || selectedShiftIds?.has(shift.id)),
    onCopy: readOnly ? undefined : onCopy,
    onCut: readOnly ? undefined : onCut,
    onPaste: readOnly ? undefined : (clipboard ? () => onPaste({ date: new Date(shift.startDateTime), roleId: shift.roleId, teamMemberId: shift.teamMemberId, targetShift: shift }) : null),
    onDelete: readOnly ? undefined : onDelete,
    onPublish: readOnly ? undefined : onPublish,
    canPaste: !readOnly && !!clipboard,
    compact: true,
  });

  const renderCell = (day, cellKey, filterFn, addContext, visibleShiftIds) => {
    const dayShifts = getShiftsForDay(day, filterFn);
    const isDragOver = !readOnly && dragOverCell === cellKey;
    const isPasteMode = !readOnly && !!clipboard;

    return (
      <div
        key={cellKey}
        className={cn(
          "p-1 border-l border-border min-h-[60px] relative group transition-colors",
          isSameDay(day, new Date()) && "bg-primary/5",
          isDragOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
          isPasteMode && "cursor-copy hover:bg-primary/10"
        )}
        onDragOver={readOnly ? undefined : (e) => handleDragOver(e, cellKey)}
        onDragLeave={readOnly ? undefined : () => setDragOverCell(null)}
        onDrop={readOnly ? undefined : (e) => handleDrop(e, { day, ...addContext })}
        onMouseEnter={readOnly ? undefined : () => onHoverCell?.({ date: day, ...addContext })}
        onClick={(e) => {
          if (readOnly) return;
          if (isPasteMode) {
            onPaste({ date: day, ...addContext });
          } else if (e.target === e.currentTarget) {
            onShiftSelect(null);
          }
        }}
      >
        <div className="space-y-1">
          {dayShifts.map(shift => (
            <ShiftCard key={shift.id} shift={shift} {...shiftCardProps(shift, visibleShiftIds)} />
          ))}
        </div>
        {!readOnly && (
          <button
            className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-10"
            onClick={(e) => { e.stopPropagation(); onAddShift({ date: day, ...addContext }); }}
          >
            <div className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center hover:bg-primary/10">
              <Plus className="w-3 h-3 text-muted-foreground" />
            </div>
          </button>
        )}
      </div>
    );
  };

  // Dynamic grid style based on number of days
  const gridStyle = { gridTemplateColumns: `160px repeat(${spanDays}, minmax(${isCompact ? 60 : 80}px, 1fr))` };

  const DayHeader = () => (
    <>
      <div className="p-2 text-xs font-semibold text-muted-foreground">
        {viewMode === 'role' ? 'Role / Team Member' : 'Team Member'}
      </div>
      {days.map(day => (
        <div key={day.toISOString()} className={cn(
          "p-1 text-center border-l border-border",
          isSameDay(day, new Date()) && "bg-primary/5"
        )}>
          <p className="text-[10px] text-muted-foreground uppercase">{format(day, isCompact ? 'EEEEE' : 'EEE')}</p>
          <p className={cn("text-xs font-semibold", isSameDay(day, new Date()) && "text-primary")}>
            {format(day, isCompact ? 'd' : 'd')}
          </p>
          {isCompact && (
            <p className="text-[9px] text-muted-foreground">{format(day, 'MMM')}</p>
          )}
        </div>
      ))}
    </>
  );

  const TmLabel = ({ tm }) => {
    const name = `${tm.preferredName || tm.firstName} ${tm.lastName?.[0]}.`;
    return (
      <div
        className={cn("p-2 flex items-center select-none", !readOnly && "cursor-context-menu")}
        onContextMenu={readOnly ? undefined : (e) => handleTmContextMenu(e, tm.id)}
      >
        {onTeamMemberClick ? (
          <button
            type="button"
            className="text-xs font-medium truncate text-left hover:text-primary hover:underline cursor-pointer"
            title="Edit team member"
            onClick={(e) => { e.stopPropagation(); onTeamMemberClick(tm); }}
          >
            {name}
          </button>
        ) : (
          <span className="text-xs font-medium truncate">{name}</span>
        )}
      </div>
    );
  };

  const TmContextMenu = () => {
    if (readOnly || !tmContextMenu) return null;
    return (
      <div
        className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-52"
        style={{ left: tmContextMenu.x, top: tmContextMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {clipboard && (
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left rounded hover:bg-accent transition-colors"
            onMouseDown={(e) => {
              e.stopPropagation();
              closeTmContextMenu();
              onPaste({ date: new Date(), teamMemberId: tmContextMenu.teamMemberId });
            }}
          >
            <span className="text-sm">📋</span>
            <span className="flex-1">Paste {clipboard.shifts.length > 1 ? `${clipboard.shifts.length} Shifts` : 'Shift'} Here</span>
          </button>
        )}
        {clipboard && <div className="my-1 border-t border-border" />}
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left rounded hover:bg-accent transition-colors"
          onMouseDown={(e) => {
            e.stopPropagation();
            closeTmContextMenu();
            onCopyMemberShifts?.(tmContextMenu.teamMemberId);
          }}
        >
          <span className="text-sm">📅</span>
          <span className="flex-1">Copy All Shifts (This Week)</span>
        </button>
      </div>
    );
  };

  // Build ordered list of visible shift IDs (for shift+click range selection)
  // Order matches DOM render order: sorted by day within each row
  const buildVisibleShiftIds = () => {
    const ids = [];
    if (viewMode === 'role') {
      const fRoleIds = new Set(filteredRoles.map(r => r.id));
      filteredRoles.forEach(role => {
        if (collapsedRoles.has(role.id)) return;
        // open shifts for this role
        days.forEach(day => {
          shifts.filter(s => !s.teamMemberId && s.roleId === role.id && onBusinessDay(s, day))
            .forEach(s => ids.push(s.id));
        });
        // assigned TM shifts
        const roleTeamMembers = filteredTeamMembers.filter(tm =>
          tm.assignedRoleIds?.includes(role.id) ||
          shifts.some(s => s.roleId === role.id && s.teamMemberId === tm.id)
        );
        roleTeamMembers.forEach(tm => {
          days.forEach(day => {
            shifts.filter(s => s.teamMemberId === tm.id && s.roleId === role.id && onBusinessDay(s, day))
              .forEach(s => ids.push(s.id));
          });
        });
      });
      // orphaned open shifts
      days.forEach(day => {
        shifts.filter(s => !s.teamMemberId && !fRoleIds.has(s.roleId) && onBusinessDay(s, day))
          .forEach(s => ids.push(s.id));
      });
    } else {
      // open shifts first
      days.forEach(day => {
        shifts.filter(s => !s.teamMemberId && onBusinessDay(s, day))
          .forEach(s => ids.push(s.id));
      });
      filteredTeamMembers.forEach(tm => {
        days.forEach(day => {
          shifts.filter(s => s.teamMemberId === tm.id && onBusinessDay(s, day))
            .forEach(s => ids.push(s.id));
        });
      });
    }
    return ids;
  };
  const visibleShiftIds = buildVisibleShiftIds();

  // Reset ref arrays before each render so stale nodes don't accumulate
  rowRefs.current = {};

  if (viewMode === 'role') {
    // Collect role IDs present in filteredRoles for lookup
    const filteredRoleIds = new Set(filteredRoles.map(r => r.id));

    // Open shifts whose roleId doesn't match any active role (orphaned)
    const orphanedOpenShifts = shifts.filter(s => !s.teamMemberId && !filteredRoleIds.has(s.roleId));

    return (
      <div className="overflow-x-auto h-full overflow-y-auto">
        <TmContextMenu />
        <div style={{ minWidth: `${160 + spanDays * (isCompact ? 60 : 80)}px` }}>
          <div className="grid border-b border-border sticky top-0 bg-card z-10" style={gridStyle}>
            <DayHeader />
          </div>
          {filteredRoles.map(role => {
            // Show TMs assigned to this role, OR who have shifts for this role this week
            const roleTeamMembers = filteredTeamMembers.filter(tm =>
              tm.assignedRoleIds?.includes(role.id) || 
              shifts.some(s => s.roleId === role.id && s.teamMemberId === tm.id)
            );
            const openShiftsForRole = shifts.filter(s => s.roleId === role.id && !s.teamMemberId);
            const hasOpenShifts = openShiftsForRole.length > 0;
            const isCollapsed = collapsedRoles.has(role.id);
            // par coverage across the visible days for this role
            let roleShort = 0, roleHasPar = false;
            if (parWindows.length) days.forEach(day => {
              const cov = roleDayCoverage(parWindows, shifts, role.id, day, dayStartHour, selectedLocation);
              if (cov.length) roleHasPar = true;
              roleShort += cov.filter(c => c.status === 'short').length;
            });
            return (
              <div key={role.id}>
                <div
                  className="grid bg-muted/50 border-b border-border cursor-pointer hover:bg-muted/70 transition-colors"
                  style={{ gridTemplateColumns: '1fr' }}
                  onClick={() => toggleRole(role.id)}
                >
                  <div className="p-2 flex items-center gap-2">
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    }
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: role.color || '#6366f1' }} />
                    <span className="text-xs font-semibold">{role.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({roleTeamMembers.length}{hasOpenShifts ? <> + <span className="text-red-500 font-semibold">{openShiftsForRole.length} open</span></> : ''})
                    </span>
                    {roleShort > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" title="Understaffed par windows this week">
                        {roleShort} under par
                      </span>
                    ) : roleHasPar ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" title="All par windows met this week">
                        par met
                      </span>
                    ) : null}
                  </div>
                </div>
                {!isCollapsed && (
                  <>
                    {/* Open / unassigned shifts row */}
                    {hasOpenShifts && (
                      <div className="grid border-b border-border bg-amber-500/5 hover:bg-amber-500/10 transition-colors" style={gridStyle}>
                        <div className="p-2 flex items-center gap-1.5">
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Open Shift</span>
                        </div>
                        {days.map(day =>
                          renderCell(
                            day,
                            `${role.id}-open-${day.toISOString()}`,
                            s => !s.teamMemberId && s.roleId === role.id,
                            { roleId: role.id, teamMemberId: null },
                            visibleShiftIds
                          )
                        )}
                      </div>
                    )}
                    {roleTeamMembers.map(tm => (
                      <div key={`${role.id}-${tm.id}`} ref={el => { if (el) { if (!rowRefs.current[tm.id]) rowRefs.current[tm.id] = []; if (!rowRefs.current[tm.id].includes(el)) rowRefs.current[tm.id].push(el); } }} className="grid border-b border-border hover:bg-muted/20 transition-colors" style={gridStyle}>
                        <TmLabel tm={tm} />
                        {days.map(day =>
                          renderCell(
                            day,
                            `${role.id}-${tm.id}-${day.toISOString()}`,
                            s => s.teamMemberId === tm.id && s.roleId === role.id,
                            { roleId: role.id, teamMemberId: tm.id },
                            visibleShiftIds
                          )
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
          {/* Open shifts with no matching active role */}
          {orphanedOpenShifts.length > 0 && (
            <div>
              <div className="grid bg-amber-500/10 border-b border-border" style={{ gridTemplateColumns: '1fr' }}>
                <div className="p-2 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Unassigned Open Shifts</span>
                  <span className="text-[10px] text-muted-foreground">({orphanedOpenShifts.length})</span>
                </div>
              </div>
              <div className="grid border-b border-border bg-amber-500/5 hover:bg-amber-500/10 transition-colors" style={gridStyle}>
                <div className="p-2 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Open</span>
                </div>
                {days.map(day =>
                  renderCell(
                    day,
                    `orphan-open-${day.toISOString()}`,
                    s => !s.teamMemberId && !filteredRoleIds.has(s.roleId),
                    { teamMemberId: null },
                    visibleShiftIds
                  )
                )}
              </div>
            </div>
          )}
          {/* Show TMs who aren't covered by any role section */}
          {(() => {
            const coveredTmIds = new Set(
              filteredRoles.flatMap(role =>
                filteredTeamMembers
                  .filter(tm =>
                    tm.assignedRoleIds?.includes(role.id) ||
                    shifts.some(s => s.roleId === role.id && s.teamMemberId === tm.id)
                  )
                  .map(tm => tm.id)
              )
            );
            const uncoveredTms = filteredTeamMembers.filter(tm => !coveredTmIds.has(tm.id));
            if (uncoveredTms.length === 0) return null;
            return (
              <div>
                <div className="grid bg-muted/50 border-b border-border" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="p-2 flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
                    <span className="text-xs font-semibold text-muted-foreground">No Role Assigned</span>
                    <span className="text-[10px] text-muted-foreground">({uncoveredTms.length})</span>
                  </div>
                </div>
                {uncoveredTms.map(tm => (
                  <div key={`unassigned-${tm.id}`} ref={el => { if (el) { if (!rowRefs.current[tm.id]) rowRefs.current[tm.id] = []; if (!rowRefs.current[tm.id].includes(el)) rowRefs.current[tm.id].push(el); } }} className="grid border-b border-border hover:bg-muted/20 transition-colors" style={gridStyle}>
                    <TmLabel tm={tm} />
                    {days.map(day =>
                      renderCell(
                        day,
                        `unassigned-${tm.id}-${day.toISOString()}`,
                        s => s.teamMemberId === tm.id,
                        { teamMemberId: tm.id },
                        visibleShiftIds
                      )
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          {filteredTeamMembers.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No team members found for the selected location.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Team Member view
  const hasAnyOpenShifts = shifts.some(s => !s.teamMemberId);
  return (
    <div className="overflow-x-auto h-full overflow-y-auto">
      <TmContextMenu />
      <div style={{ minWidth: `${160 + spanDays * (isCompact ? 60 : 80)}px` }}>
        <div className="grid border-b border-border sticky top-0 bg-card z-10" style={gridStyle}>
          <DayHeader />
        </div>
        {/* Open / unassigned shifts row */}
        {hasAnyOpenShifts && (
          <div className="grid border-b border-border bg-amber-500/5 hover:bg-amber-500/10 transition-colors" style={gridStyle}>
            <div className="p-2 flex items-center gap-1.5">
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Open Shift</span>
            </div>
            {days.map(day =>
              renderCell(
                day,
                `open-${day.toISOString()}`,
                s => !s.teamMemberId,
                { teamMemberId: null },
                visibleShiftIds
              )
            )}
          </div>
        )}
        {filteredTeamMembers.map(tm => (
          <div key={tm.id} ref={el => { if (el) { rowRefs.current[tm.id] = [el]; } }} className="grid border-b border-border hover:bg-muted/20 transition-colors" style={gridStyle}>
            <TmLabel tm={tm} />
            {days.map(day =>
              renderCell(
                day,
                `${tm.id}-${day.toISOString()}`,
                s => s.teamMemberId === tm.id,
                { teamMemberId: tm.id },
                visibleShiftIds
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
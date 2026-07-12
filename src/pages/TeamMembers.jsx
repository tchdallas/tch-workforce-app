import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Mail, MapPin, UserPlus, Upload, Trash2, CheckSquare, Square, Undo2, Loader2, Users, Archive, ArchiveRestore } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/common/PageHeader';
import TeamMemberModal from '@/components/team/TeamMemberModal';
import ImportTeamMembersModal from '@/components/team/ImportTeamMembersModal';
import BulkInviteModal from '@/components/team/BulkInviteModal';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { cn } from '@/lib/utils';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { toast } from 'sonner';

const statusColors = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  archived: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

// display labels (db keeps active/inactive/archived; these are what users see)
const statusLabels = { active: 'Active', inactive: 'Suspended', archived: 'Termed' };

// blue "Invited" pill shown alongside for active members who haven't logged in
// yet (no linked auth account), until they accept the invite / sign in
const invitedPill = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';

export default function TeamMembers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const lastClickedIdRef = useRef(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastImportIds, setLastImportIds] = useState([]);
  const [undoingImport, setUndoingImport] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { isAdmin } = useCurrentMember();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const handleUndoImport = async () => {
    if (!lastImportIds.length) return;
    setUndoingImport(true);
    try {
      // nothing is ever hard-deleted; archiving hides them everywhere.
      // Re-importing later revives archived members automatically.
      const { count } = await base44.entities.TeamMember.updateMany(lastImportIds, { status: 'archived' });
      toast.success(`Removed ${count} imported member${count !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err.message || 'Undo failed');
    }
    setLastImportIds([]);
    setUndoingImport(false);
    queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
  };

  const toggleSelect = (id, shiftKey = false) => {
    if (shiftKey && lastClickedIdRef.current && lastClickedIdRef.current !== id) {
      const ids = filtered.map(tm => tm.id);
      const anchorIdx = ids.indexOf(lastClickedIdRef.current);
      const targetIdx = ids.indexOf(id);
      const [from, to] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      const rangeIds = ids.slice(from, to + 1);
      setSelectedIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(rid => next.add(rid));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }
    lastClickedIdRef.current = id;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(tm => tm.id)));
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      // archive, never delete: history and audit trail stay intact
      const { count } = await base44.entities.TeamMember.updateMany([...selectedIds], { status: 'archived' });
      toast.success(`Archived ${count} team member${count !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err.message || 'Archive failed');
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setBulkSelectMode(false);
    setConfirmDelete(false);
    queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      await base44.users.inviteUser(inviteEmail, 'user');
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteOpen(false);
    } catch (err) {
      toast.info(err.message);
    } finally {
      setInviting(false);
    }
  };

  // Modal state driven by URL search params for native back-button support
  const editId = searchParams.get('edit');
  const isNew = searchParams.get('new') === '1';
  const modalOpen = isNew || !!editId;

  const openNew = () => setSearchParams({ new: '1' });
  const openEdit = (id) => setSearchParams({ edit: id });
  const closeModal = () => setSearchParams({});

  const { data: teamMembers = [], isLoading: loadingMembers } = useTeamMembers();

  // archived members load only when an admin asks for them
  const { data: archivedMembers = [] } = useQuery({
    queryKey: ['teamMembers-archived'],
    queryFn: () => base44.entities.TeamMember.filter({ status: 'archived' }, 'firstName'),
    placeholderData: [],
    enabled: isAdmin && showArchived,
  });

  const { pullDistance, refreshing } = usePullToRefresh(async () => {
    await queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
  });

  const { data: locations } = useLocations();
  const { data: roles } = useRoles();

  const getLocationName = (id) => locations.find(l => l.id === id)?.name || '';
  const getRoleName = (id) => roles.find(r => r.id === id)?.name || '';
  const getRoleColor = (id) => roles.find(r => r.id === id)?.color || '#6366f1';

  // dedupe: right after an archive/restore the two lists briefly overlap
  // (one query refetches before the other), which duplicates React keys
  const displayMembers = React.useMemo(() => {
    if (!(isAdmin && showArchived)) return teamMembers;
    const seen = new Set(teamMembers.map(m => m.id));
    return [...teamMembers, ...archivedMembers.filter(m => !seen.has(m.id))];
  }, [teamMembers, archivedMembers, isAdmin, showArchived]);
  const editMember = editId ? displayMembers.find(tm => tm.id === editId) : null;

  const filtered = displayMembers.filter(tm => {
    const name = `${tm.firstName} ${tm.lastName} ${tm.preferredName || ''}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => base44.entities.TeamMember.update(id, { status: 'active' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMembers-archived'] });
      toast.success('Team member restored');
    },
    onError: (e) => toast.error(e.message || 'Could not restore'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['teamMembers'] });
      const prev = queryClient.getQueryData(['teamMembers']);
      queryClient.setQueryData(['teamMembers'], old => [
        ...(old || []),
        { ...data, id: `optimistic-${Date.now()}`, status: data.status || 'active' },
      ]);
      closeModal();
      return { prev };
    },
    onError: (_, __, ctx) => {
      queryClient.setQueryData(['teamMembers'], ctx.prev);
      openNew();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TeamMember.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['teamMembers'] });
      const prev = queryClient.getQueryData(['teamMembers']);
      queryClient.setQueryData(['teamMembers'], old =>
        (old || []).map(tm => tm.id === id ? { ...tm, ...data } : tm)
      );
      closeModal();
      return { prev };
    },
    onError: (_, { id }, ctx) => {
      queryClient.setQueryData(['teamMembers'], ctx.prev);
      openEdit(id);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
  });

  return (
    <div className="max-w-7xl mx-auto">
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />

      <PageHeader title="Team Members" subtitle={loadingMembers ? 'Loading…' : `${teamMembers.length} total members`}>
        {bulkSelectMode ? (
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={toggleSelectAll}>
              {selectedIds.size === filtered.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              disabled={selectedIds.size === 0 || bulkDeleting}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setBulkSelectMode(false); setSelectedIds(new Set()); lastClickedIdRef.current = null; }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {lastImportIds.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-400 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                onClick={handleUndoImport}
                disabled={undoingImport}
              >
                {undoingImport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                {undoingImport ? 'Undoing…' : `Undo Import (${lastImportIds.length})`}
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkInviteOpen(true)}>
              <UserPlus className="w-4 h-4" /> Invite
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" /> Import CSV
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkSelectMode(true)}>
              <Trash2 className="w-4 h-4" /> Bulk Delete
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openNew}>
              <Plus className="w-4 h-4" /> Add Team Member
            </Button>
          </>
        )}
      </PageHeader>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search team members..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant={showArchived ? 'secondary' : 'outline'}
            className="gap-1.5 shrink-0"
            onClick={() => setShowArchived(v => !v)}
          >
            <Archive className="w-4 h-4" />
            {showArchived ? `Hide Archived (${archivedMembers.length})` : 'Show Archived'}
          </Button>
        )}
      </div>

      {loadingMembers && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loadingMembers && filtered.length === 0 && !search && (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No team members yet. Click "Add Team Member" to get started.</p>
        </div>
      )}

      {!loadingMembers && filtered.length === 0 && search && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">No members match "{search}"</p>
        </div>
      )}

      <div className={loadingMembers ? 'hidden' : 'grid sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
        {filtered.map(tm => (
          <Card
            key={tm.id}
            className={cn(
              "cursor-pointer hover:shadow-md transition-shadow",
              bulkSelectMode && selectedIds.has(tm.id) && "ring-2 ring-destructive bg-destructive/5"
            )}
            onClick={(e) => bulkSelectMode ? toggleSelect(tm.id, e.shiftKey) : openEdit(tm.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-sm">
                    {tm.preferredName || tm.firstName} {tm.lastName}
                  </h3>
                  {tm.preferredName && (
                    <p className="text-[11px] text-muted-foreground">{tm.firstName} {tm.lastName}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {tm.status === 'active' && !tm.userId && (
                    <Badge className={cn("text-[10px] border-0", invitedPill)} title="Hasn't accepted the invite / logged in yet">
                      Invited
                    </Badge>
                  )}
                  <Badge className={cn("text-[10px] border-0", statusColors[tm.status])}>
                    {statusLabels[tm.status] || tm.status}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1">
                {tm.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground truncate">{tm.email}</span>
                  </div>
                )}
                {tm.homeLocationId && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{getLocationName(tm.homeLocationId)}</span>
                  </div>
                )}
              </div>
              {tm.assignedRoleIds?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tm.assignedRoleIds.slice(0, 3).map(roleId => (
                    <Badge
                      key={roleId}
                      variant="outline"
                      className="text-[9px] px-1.5 py-0"
                      style={{ borderColor: getRoleColor(roleId), color: getRoleColor(roleId) }}
                    >
                      {getRoleName(roleId)}
                    </Badge>
                  ))}
                  {tm.assignedRoleIds.length > 3 && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                      +{tm.assignedRoleIds.length - 3}
                    </Badge>
                  )}
                </div>
              )}
              {isAdmin && tm.status === 'archived' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-3 gap-1.5"
                  disabled={restoreMutation.isPending}
                  onClick={(e) => { e.stopPropagation(); restoreMutation.mutate(tm.id); }}
                >
                  <ArchiveRestore className="w-4 h-4" />
                  {restoreMutation.isPending ? 'Restoring…' : 'Restore'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Send an email invite so they can log into the app.</p>
            <div>
              <Label className="text-xs">Email address</Label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail || inviting}>
              {inviting ? 'Sending…' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {selectedIds.size} team member{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived members lose app access and disappear from schedules and lists,
              but their history is preserved and they can be restored later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkInviteModal
        open={bulkInviteOpen}
        onClose={() => setBulkInviteOpen(false)}
      />

      <ImportTeamMembersModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(importedIds) => {
          if (importedIds?.length) setLastImportIds(importedIds);
          queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
        }}
      />

      <TeamMemberModal
        open={modalOpen}
        onClose={closeModal}
        member={editMember}
        locations={locations}
        roles={roles}
        existingMembers={teamMembers}
        onSave={(data) => {
          if (editMember?.id) {
            updateMutation.mutate({ id: editMember.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
      />
    </div>
  );
}
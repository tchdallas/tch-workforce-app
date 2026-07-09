import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MapPin, Trash2, Loader2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import PageHeader from '@/components/common/PageHeader';
import { useLocations } from '@/lib/useAppData';
import { toast } from 'sonner';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';

const defaultForm = { name: '', abbreviation: '', address: '', city: '', state: 'TX', zip: '', contactPhone: '', timezone: 'America/Chicago', status: 'active' };

export default function Locations() {
  const queryClient = useQueryClient();
  const { data: locations } = useLocations();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(defaultForm);

  // Modal state via URL search params
  const editId = searchParams.get('edit');
  const isNew = searchParams.get('new') === '1';
  const modalOpen = isNew || !!editId;

  const editLoc = editId ? locations.find(l => l.id === editId) : null;

  const openNew = () => { setForm(defaultForm); setSearchParams({ new: '1' }); };
  const openEdit = (loc) => { setForm(loc); setSearchParams({ edit: loc.id }); };
  const closeModal = () => setSearchParams({});

  // Sync form when editLoc changes (e.g. navigating back/forward)
  useEffect(() => {
    if (editLoc) setForm(editLoc);
    else if (isNew) setForm(defaultForm);
  }, [editId, isNew]);

  const { pullDistance, refreshing } = usePullToRefresh(async () => {
    await queryClient.invalidateQueries({ queryKey: ['locations'] });
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editLoc?.id
      ? base44.entities.Location.update(editLoc.id, data)
      : base44.entities.Location.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      closeModal();
      toast.success(editLoc ? 'Location updated' : 'Location created');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Location.update(id, { status: 'archived' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      closeModal();
      toast.success('Location archived');
    },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />

      <PageHeader title="Locations" subtitle={`${locations.length} locations`}>
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="w-4 h-4" /> Add Location
        </Button>
      </PageHeader>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {locations.map(loc => (
          <Card key={loc.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(loc)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                    <MapPin className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{loc.name}</h3>
                    {loc.abbreviation && <p className="text-[11px] text-muted-foreground">{loc.abbreviation}</p>}
                    {loc.city && <p className="text-xs text-muted-foreground mt-1">{loc.city}, {loc.state}</p>}
                  </div>
                </div>
                <Badge variant={loc.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                  {loc.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={(o) => { if (!o) closeModal(); }}>
        <DialogContent className="pb-[env(safe-area-inset-bottom,0px)] sm:pb-0">
          <DialogHeader>
            <DialogTitle>{editLoc ? 'Edit Location' : 'New Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., TCH Social Austin" />
            </div>
            <div>
              <Label className="text-xs">Abbreviation</Label>
              <Input value={form.abbreviation || ''} onChange={e => setForm(f => ({ ...f, abbreviation: e.target.value }))} placeholder="e.g., AUS" />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Contact Phone</Label>
              <Input type="tel" value={form.contactPhone || ''} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="e.g., (512) 555-0100" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">City</Label>
                <Input value={form.city || ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">State</Label>
                <Input value={form.state || ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Zip</Label>
                <Input value={form.zip || ''} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            {editLoc && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="sm:mr-auto" disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-4 h-4" /> Archive</>}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive "{editLoc.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>The location will be hidden from all lists and schedules. Its history is preserved and it can be restored later.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteMutation.mutate(editLoc.id)}>Archive</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name}>
              {editLoc ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
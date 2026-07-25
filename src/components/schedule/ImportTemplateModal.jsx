import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useLocations, useRoles } from '@/lib/useAppData';
import { format, startOfWeek, addDays } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ImportTemplateModal({ open, onClose, weekStart, selectedLocation, onImported }) {
  const [templateId, setTemplateId] = useState('');
  const [importing, setImporting] = useState(false);

  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();

  const { data: templates = [] } = useQuery({
    queryKey: ['schedule-templates'],
    queryFn: () => base44.entities.ScheduleTemplate.filter({ status: 'active' }),
    staleTime: 30000,
  });

  const selectedTemplate = templates.find(t => t.id === templateId);

  // Group template shifts by day for preview
  const shiftsByDay = useMemo(() => {
    if (!selectedTemplate) return {};
    const map = {};
    (selectedTemplate.shifts || []).forEach(s => {
      if (!map[s.dayOfWeek]) map[s.dayOfWeek] = [];
      map[s.dayOfWeek].push(s);
    });
    return map;
  }, [selectedTemplate]);

  const totalShiftsToCreate = (selectedTemplate?.shifts || []).length;

  const handleImport = async () => {
    if (!templateId) { toast.error('Please select a template'); return; }
    if (!selectedTemplate?.shifts?.length) { toast.error('Selected template has no shifts'); return; }
    if (!selectedLocation || selectedLocation === 'all') {
      toast.error('Please select a specific location in the schedule view before importing a template');
      return;
    }

    setImporting(true);
    try {
      const locationId = selectedLocation;

      // Build one Shift record per template shift entry
      const shiftsToCreate = (selectedTemplate.shifts || []).map(tmplShift => {
        // Calculate the actual date for this day of week in the target week
        const targetDate = addDays(weekStart, tmplShift.dayOfWeek);
        const [startH, startM] = (tmplShift.startTime || '09:00').split(':').map(Number);
        const [endH, endM] = (tmplShift.endTime || '17:00').split(':').map(Number);

        const startDt = new Date(targetDate);
        startDt.setHours(startH, startM, 0, 0);

        const endDt = new Date(targetDate);
        endDt.setHours(endH, endM, 0, 0);
        // Handle overnight shifts
        if (endDt <= startDt) endDt.setDate(endDt.getDate() + 1);

        return {
          locationId,
          roleId: tmplShift.roleId,
          teamMemberId: null,       // open shift — unassigned
          startDateTime: startDt.toISOString(),
          endDateTime: endDt.toISOString(),
          breakMinutes: tmplShift.breakMinutes || 0,
          status: 'draft',
          shiftType: 'open',
          coverageStatus: 'open',
        };
      });

      await base44.entities.Shift.bulkCreate(shiftsToCreate);
      toast.success(`${shiftsToCreate.length} open shift${shiftsToCreate.length !== 1 ? 's' : ''} created from template`);
      setTemplateId('');
      onImported();
    } catch (err) {
      // never fail silently — the old code let this reject unhandled ("nothing happens")
      const msg = /row-level security|has_location_access/i.test(err?.message || '')
        ? "You don't have access to the schedule's selected location. Switch to one of your locations and try again."
        : (err?.message || 'Could not import the template.');
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (importing) return;
    setTemplateId('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Import Template
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Week info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            <CalendarIcon className="w-4 h-4 flex-shrink-0" />
            <span>Importing into week of <span className="font-semibold text-foreground">{format(weekStart, 'MMM d, yyyy')}</span></span>
          </div>

          {/* Template selector */}
          <div>
            <Label className="text-xs mb-1.5 block">Select Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 && (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center">No templates available</div>
                )}
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <span>{t.name}</span>
                      <span className="text-xs text-muted-foreground">({(t.shifts || []).length} shifts)</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          {selectedTemplate && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold">Preview</span>
                <Badge variant="outline" className="text-xs">{totalShiftsToCreate} shifts</Badge>
              </div>
              <div className="divide-y divide-border max-h-52 overflow-y-auto">
                {DAYS.map((day, idx) => {
                  const dayShifts = shiftsByDay[idx] || [];
                  if (dayShifts.length === 0) return null;
                  return (
                    <div key={idx} className="px-3 py-2 flex items-start gap-3">
                      <span className="text-xs font-medium w-8 text-muted-foreground pt-0.5">{day}</span>
                      <div className="flex flex-col gap-1 flex-1">
                        {dayShifts.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="font-medium">{s.startTime} – {s.endTime}</span>
                            <Badge variant="secondary" className="text-[10px] py-0">
                            {roles.find(r => r.id === s.roleId)?.name || 'Role'}
                          </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {totalShiftsToCreate === 0 && (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">This template has no shifts.</div>
                )}
              </div>
              <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                All shifts will be created as <span className="font-medium text-foreground">open (unassigned) drafts</span> for location <span className="font-medium text-foreground">{locations.find(l => l.id === selectedLocation)?.name || '—'}</span>.
                {(!selectedLocation || selectedLocation === 'all') && (
                  <span className="block text-amber-600 mt-1">⚠ Select a specific location in the schedule view first.</span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing || !templateId}>
            {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : `Import ${totalShiftsToCreate > 0 ? totalShiftsToCreate + ' ' : ''}Shift${totalShiftsToCreate !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
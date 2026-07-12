import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ENTRY_TYPES, NATURES, entryTypeLabel } from './disciplineShared';

// Create or edit a DRAFT Performance Documentation, then optionally issue it
// (typed-name signature). Field names mirror the paper form.
export default function DisciplineFormDialog({ memberId, memberName, existing, priorDocs = [], isAdmin, onClose }) {
  const queryClient = useQueryClient();

  const priorSummary = priorDocs
    .filter(d => ['issued', 'acknowledged', 'refused'].includes(d.status))
    .map(d => `${format(parseISO(d.issuedAt?.slice(0, 10) || d.createdAt.slice(0, 10)), 'M/d/yyyy')} — ${entryTypeLabel(d.entryType)}`)
    .join('; ');

  const [form, setForm] = useState(existing ? {
    entryType: existing.entryType,
    suspensionDays: existing.suspensionDays || '',
    natures: existing.natures || [],
    priorDocumentation: existing.priorDocumentation || '',
    incidentWhenWhere: existing.incidentWhenWhere || '',
    observedBehavior: existing.observedBehavior || '',
    whyImportant: existing.whyImportant || '',
    correctionPlan: existing.correctionPlan || '',
    consequence: existing.consequence,
  } : {
    entryType: '',
    suspensionDays: '',
    natures: [],
    priorDocumentation: priorSummary || 'N/A',
    incidentWhenWhere: '',
    observedBehavior: '',
    whyImportant: '',
    correctionPlan: '',
    consequence: 'Continuing like behavior, or failure to comply with company policies may result in additional discipline up to and including termination.',
  });

  const [signature, setSignature] = useState('');
  const [showIssue, setShowIssue] = useState(false);

  const availableTypes = ENTRY_TYPES.filter(t => !t.adminOnly || isAdmin);
  const isSPI = form.entryType === 'suspension_pending_investigation';

  const toggleNature = (v) =>
    setForm(f => ({
      ...f,
      natures: f.natures.includes(v) ? f.natures.filter(x => x !== v) : [...f.natures, v],
    }));

  const buildPayload = () => ({
    teamMemberId: memberId,
    entryType: form.entryType,
    suspensionDays: isSPI ? Number(form.suspensionDays) || null : null,
    natures: form.natures,
    priorDocumentation: form.priorDocumentation.trim() || null,
    incidentWhenWhere: form.incidentWhenWhere.trim() || null,
    observedBehavior: form.observedBehavior.trim() || null,
    whyImportant: form.whyImportant.trim() || null,
    correctionPlan: form.correctionPlan.trim() || null,
    consequence: form.consequence.trim(),
  });

  const validate = (forIssue) => {
    if (!form.entryType) return 'Choose the type of entry';
    if (isSPI && (!form.suspensionDays || Number(form.suspensionDays) <= 0)) return 'Enter the number of suspension days';
    if (forIssue) {
      if (form.natures.length === 0) return 'Choose at least one Nature of Entry';
      if (!form.observedBehavior.trim()) return 'Describe WHAT behavior was observed';
      if (!signature.trim()) return 'Type your name to sign as the issuing manager';
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async ({ issue }) => {
      const payload = buildPayload();
      let docId = existing?.id;
      if (docId) {
        await base44.entities.DisciplineDocument.update(docId, payload);
      } else {
        const created = await base44.entities.DisciplineDocument.create(payload);
        docId = created.id;
      }
      if (issue) {
        const { error } = await supabase.rpc('issue_discipline_document', {
          p_id: docId, p_signed_name: signature.trim(),
        });
        if (error) throw error;
      }
      return { issue };
    },
    onSuccess: ({ issue }) => {
      queryClient.invalidateQueries({ queryKey: ['discipline-docs'] });
      toast.success(issue
        ? `Issued — ${memberName} has been notified to review and sign`
        : 'Draft saved');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handle = (issue) => {
    const err = validate(issue);
    if (err) { toast.error(err); return; }
    saveMutation.mutate({ issue });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">Performance Documentation</DialogTitle>
          <DialogDescription>
            {memberName} · {existing ? 'Editing draft' : 'New document'} — nothing is visible to the team member until you issue it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type of Entry</Label>
              <Select value={form.entryType} onValueChange={v => setForm(f => ({ ...f, entryType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {availableTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isAdmin && (
                <p className="text-[11px] text-muted-foreground mt-1">Suspension and Separation require an admin.</p>
              )}
            </div>
            {isSPI && (
              <div>
                <Label className="text-xs">Suspension days</Label>
                <Input type="number" min="1" value={form.suspensionDays}
                       onChange={e => setForm(f => ({ ...f, suspensionDays: e.target.value }))} />
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Nature of Entry</Label>
            <div className="flex flex-wrap gap-3">
              {NATURES.map(n => (
                <label key={n.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={form.natures.includes(n.value)}
                         onChange={() => toggleNature(n.value)} />
                  {n.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Prior Documentation (dates and type of entry)</Label>
            <Textarea rows={2} value={form.priorDocumentation}
                      onChange={e => setForm(f => ({ ...f, priorDocumentation: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs">WHEN and WHERE the incident occurred</Label>
            <Textarea rows={2} value={form.incidentWhenWhere}
                      onChange={e => setForm(f => ({ ...f, incidentWhenWhere: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs">WHAT was the actual behavior observed (versus the expectation)?</Label>
            <Textarea rows={3} value={form.observedBehavior}
                      onChange={e => setForm(f => ({ ...f, observedBehavior: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs">WHY this is important (or what policy was violated)</Label>
            <Textarea rows={2} value={form.whyImportant}
                      onChange={e => setForm(f => ({ ...f, whyImportant: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs">HOW can the behavior be corrected going forward?</Label>
            <Textarea rows={2} value={form.correctionPlan}
                      onChange={e => setForm(f => ({ ...f, correctionPlan: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs">CONSEQUENCE if behavior continues</Label>
            <Textarea rows={2} value={form.consequence}
                      onChange={e => setForm(f => ({ ...f, consequence: e.target.value }))} />
          </div>

          {showIssue && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
              <Label className="text-xs font-semibold">Issue this document</Label>
              <p className="text-[11px] text-muted-foreground">
                Issuing locks the document, notifies {memberName}, and requests their signature.
                Type your full name below as the issuing manager's signature.
              </p>
              <Input placeholder="Your full name" value={signature} onChange={e => setSignature(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={saveMutation.isPending} onClick={() => handle(false)}>
            Save Draft
          </Button>
          {showIssue ? (
            <Button disabled={saveMutation.isPending || !signature.trim()} onClick={() => handle(true)}>
              Sign & Issue
            </Button>
          ) : (
            <Button onClick={() => setShowIssue(true)}>Issue…</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

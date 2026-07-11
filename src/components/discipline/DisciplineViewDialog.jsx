import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  entryTypeLabel, natureLabel, DOC_STATUS, SIGNATURE_DISCLAIMER,
} from './disciplineShared';

const fmtTs = (ts) => (ts ? format(new Date(ts), 'MMM d, yyyy h:mm a') : '');

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function SignatureLine({ role, name, at, refusedAt }) {
  return (
    <div className="flex items-center justify-between text-sm border-t pt-2">
      <span className="text-muted-foreground">{role}</span>
      {name ? (
        <span className="text-right">
          <span className="font-medium italic">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{fmtTs(at)}</span>
        </span>
      ) : refusedAt ? (
        <span className="text-right text-orange-600 dark:text-orange-400">
          Declined to sign
          <span className="block text-[11px] text-muted-foreground">{fmtTs(refusedAt)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground italic">— unsigned —</span>
      )}
    </div>
  );
}

// Read-only rendering of an issued document plus the contextual actions:
//   perspective="manager": witness-sign (manager+), void (admin+)
//   perspective="member":  sign / refuse with comments (only while 'issued')
export default function DisciplineViewDialog({ doc, memberName, perspective, isAdmin, currentMemberId, onClose }) {
  const queryClient = useQueryClient();
  const status = DOC_STATUS[doc.status] || DOC_STATUS.draft;

  const [mode, setMode] = useState(null); // 'sign' | 'refuse' | 'witness' | 'void'
  const [typedName, setTypedName] = useState('');
  const [comments, setComments] = useState('');

  const done = (msg) => {
    queryClient.invalidateQueries({ queryKey: ['discipline-docs'] });
    queryClient.invalidateQueries({ queryKey: ['my-discipline-docs'] });
    toast.success(msg);
    onClose();
  };

  const act = useMutation({
    mutationFn: async (kind) => {
      const call = {
        sign:    () => supabase.rpc('sign_discipline_document', { p_id: doc.id, p_signed_name: typedName.trim(), p_comments: comments.trim() || null }),
        refuse:  () => supabase.rpc('refuse_discipline_document', { p_id: doc.id, p_comments: comments.trim() || null }),
        witness: () => supabase.rpc('witness_discipline_document', { p_id: doc.id, p_signed_name: typedName.trim() }),
        void:    () => supabase.rpc('void_discipline_document', { p_id: doc.id, p_reason: comments.trim() }),
      }[kind];
      const { error } = await call();
      if (error) throw error;
      return kind;
    },
    onSuccess: (kind) => done({
      sign: 'Signed — thank you',
      refuse: 'Your refusal to sign has been recorded',
      witness: 'Witnessed',
      void: 'Document voided',
    }[kind]),
    onError: (e) => toast.error(e.message),
  });

  const canWitness = perspective === 'manager'
    && ['issued', 'acknowledged', 'refused'].includes(doc.status)
    && !doc.witnessSignedAt
    && doc.teamMemberId !== currentMemberId;
  const canVoid = perspective === 'manager' && isAdmin && doc.status !== 'voided';
  const canRespond = perspective === 'member' && doc.status === 'issued';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">Performance Documentation</DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{memberName}</span>
            <Badge className={`text-[10px] border-0 ${status.cls}`}>{status.label}</Badge>
            {doc.issuedAt && <span className="text-xs">Issued {fmtTs(doc.issuedAt)}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{entryTypeLabel(doc.entryType)}
              {doc.entryType === 'suspension_pending_investigation' && doc.suspensionDays
                ? ` — ${doc.suspensionDays} day${doc.suspensionDays === 1 ? '' : 's'}` : ''}
            </Badge>
            {(doc.natures || []).map(n => (
              <Badge key={n} variant="outline" className="text-muted-foreground">{natureLabel(n)}</Badge>
            ))}
          </div>

          {doc.status === 'voided' && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <span className="font-medium">Voided</span> {fmtTs(doc.voidedAt)}
              {doc.voidReason && <> — {doc.voidReason}</>}
            </div>
          )}

          <Field label="Prior documentation" value={doc.priorDocumentation} />
          <Field label="When and where the incident occurred" value={doc.incidentWhenWhere} />
          <Field label="What was the actual behavior observed (versus the expectation)" value={doc.observedBehavior} />
          <Field label="Why this is important (or what policy was violated)" value={doc.whyImportant} />
          <Field label="How the behavior can be corrected going forward" value={doc.correctionPlan} />
          <Field label="Consequence if behavior continues" value={doc.consequence} />
          <Field label="Employee comments" value={doc.employeeComments} />

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">{SIGNATURE_DISCLAIMER}</p>
            <SignatureLine role="Issuing Sup./Mgr." name={doc.issuerSignedName} at={doc.issuedAt} />
            <SignatureLine role="Employee" name={doc.memberSignedName} at={doc.memberSignedAt} refusedAt={doc.memberRefusedAt} />
            {(doc.witnessSignedName || canWitness) && (
              <SignatureLine role="Witness" name={doc.witnessSignedName} at={doc.witnessSignedAt} />
            )}
          </div>

          {/* contextual action panels */}
          {mode === 'sign' && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
              <Label className="text-xs font-semibold">Sign this document</Label>
              <Input placeholder="Type your full name" value={typedName} onChange={e => setTypedName(e.target.value)} />
              <Textarea rows={2} placeholder="Your comments (optional — kept on the document)"
                        value={comments} onChange={e => setComments(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
                <Button size="sm" disabled={!typedName.trim() || act.isPending} onClick={() => act.mutate('sign')}>
                  Sign
                </Button>
              </div>
            </div>
          )}

          {mode === 'refuse' && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-900/10 p-3 space-y-2">
              <Label className="text-xs font-semibold">Decline to sign</Label>
              <p className="text-[11px] text-muted-foreground">
                Your refusal will be recorded with a timestamp. Per policy, refusing to sign does not
                remove the disciplinary action.
              </p>
              <Textarea rows={2} placeholder="Your comments (optional — kept on the document)"
                        value={comments} onChange={e => setComments(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
                <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate('refuse')}>
                  Record refusal
                </Button>
              </div>
            </div>
          )}

          {mode === 'witness' && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
              <Label className="text-xs font-semibold">Sign as witness</Label>
              <Input placeholder="Type your full name" value={typedName} onChange={e => setTypedName(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
                <Button size="sm" disabled={!typedName.trim() || act.isPending} onClick={() => act.mutate('witness')}>
                  Sign as witness
                </Button>
              </div>
            </div>
          )}

          {mode === 'void' && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <Label className="text-xs font-semibold">Void this document</Label>
              <p className="text-[11px] text-muted-foreground">
                Voiding strikes the document from the member's record (it stays in the audit trail). Reason required.
              </p>
              <Textarea rows={2} placeholder="Reason (required)" value={comments} onChange={e => setComments(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
                <Button size="sm" variant="destructive" disabled={!comments.trim() || act.isPending}
                        onClick={() => act.mutate('void')}>
                  Void document
                </Button>
              </div>
            </div>
          )}
        </div>

        {!mode && (
          <DialogFooter className="gap-2">
            {canVoid && (
              <Button variant="outline" className="text-destructive hover:text-destructive mr-auto"
                      onClick={() => { setComments(''); setMode('void'); }}>
                Void…
              </Button>
            )}
            {canWitness && (
              <Button variant="outline" onClick={() => { setTypedName(''); setMode('witness'); }}>
                Sign as witness
              </Button>
            )}
            {canRespond && (
              <>
                <Button variant="outline" onClick={() => { setComments(''); setMode('refuse'); }}>
                  Decline to sign
                </Button>
                <Button onClick={() => { setTypedName(''); setComments(''); setMode('sign'); }}>
                  Review & sign
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

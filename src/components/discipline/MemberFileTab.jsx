import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Plus, FileText, NotebookPen } from 'lucide-react';
import DisciplineFormDialog from './DisciplineFormDialog';
import DisciplineViewDialog from './DisciplineViewDialog';
import { entryTypeShort, DOC_STATUS, SENTIMENTS, sentimentMeta } from './disciplineShared';

// The "File" tab on a team member's profile (manager view):
// journal entries (notes to file) + progressive discipline documents.
export default function MemberFileTab({ memberId, memberName, canManage = true }) {
  const queryClient = useQueryClient();
  const { member: me, isAdmin } = useCurrentMember();
  const { data: teamMembers = [] } = useTeamMembers();

  const { data: journal = [] } = useQuery({
    queryKey: ['journal-entries', memberId],
    queryFn: () => base44.entities.JournalEntry.filter({ teamMemberId: memberId }),
    placeholderData: [],
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['discipline-docs', memberId],
    queryFn: () => base44.entities.DisciplineDocument.filter({ teamMemberId: memberId }),
    placeholderData: [],
  });

  const sortedJournal = useMemo(
    () => [...journal].sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1)),
    [journal]
  );
  const sortedDocs = useMemo(
    () => [...docs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [docs]
  );

  const authorName = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Manager';
  };

  // --- quick journal add ---
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [sentiment, setSentiment] = useState('neutral');
  const [informed, setInformed] = useState(false);
  const [shared, setShared] = useState(false);

  const addNote = useMutation({
    mutationFn: () => base44.entities.JournalEntry.create({
      teamMemberId: memberId,
      authorId: me.id,
      sentiment,
      note: note.trim(),
      informed,
      sharedWithMember: shared,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries', memberId] });
      setNote(''); setSentiment('neutral'); setInformed(false); setShared(false); setAdding(false);
      toast.success(shared ? 'Note saved and shared with the team member' : 'Note saved to file');
    },
    onError: (e) => toast.error(e.message),
  });

  // --- discipline dialogs ---
  const [formDoc, setFormDoc] = useState(undefined); // undefined = closed, null = new, object = edit draft
  const [viewDoc, setViewDoc] = useState(null);

  return (
    <div className="space-y-5">
      {/* Progressive discipline */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Performance Documentation
          </h3>
          {canManage && (
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setFormDoc(null)}>
              <Plus className="w-3.5 h-3.5" /> New Document
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          {sortedDocs.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No documents on file.</p>
          )}
          {sortedDocs.map(d => {
            const st = DOC_STATUS[d.status] || DOC_STATUS.draft;
            return (
              <button
                key={d.id}
                className="w-full text-left border rounded-lg px-3 py-2 hover:bg-accent/40 transition-colors"
                onClick={() => (d.status === 'draft' ? setFormDoc(d) : setViewDoc(d))}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{entryTypeShort(d.entryType)}
                    <span className="text-xs text-muted-foreground ml-2">
                      {format(parseISO(d.createdAt.slice(0, 10)), 'MMM d, yyyy')}
                    </span>
                  </span>
                  <Badge className={`text-[10px] border-0 ${st.cls}`}>{st.label}</Badge>
                </div>
                {d.observedBehavior && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{d.observedBehavior}</p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Journal / notes to file */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <NotebookPen className="w-4 h-4" /> Notes to File
          </h3>
          {canManage && !adding && (
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setAdding(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Note
            </Button>
          )}
        </div>

        {adding && (
          <div className="border rounded-lg p-3 space-y-2 mb-3">
            <div className="flex gap-2">
              <Select value={sentiment} onValueChange={setSentiment}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SENTIMENTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea rows={3} placeholder="What did you observe? (positive recognition counts too)"
                      value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={informed}
                       onChange={e => setInformed(e.target.checked)} />
                Team member was informed
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={shared}
                       onChange={e => setShared(e.target.checked)} />
                Share with team member in-app
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
                Save Note
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {sortedJournal.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground py-2">No notes on file.</p>
          )}
          {sortedJournal.map(j => {
            const s = sentimentMeta(j.sentiment);
            return (
              <div key={j.id} className="border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(j.entryDate), 'MMM d, yyyy')} · {authorName(j.authorId)}
                  </span>
                  <span className="flex gap-1">
                    <Badge className={`text-[10px] border-0 ${s.cls}`}>{s.label}</Badge>
                    {j.informed && <Badge variant="outline" className="text-[10px]">Informed</Badge>}
                    {j.sharedWithMember && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
                  </span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{j.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      {formDoc !== undefined && (
        <DisciplineFormDialog
          memberId={memberId}
          memberName={memberName}
          existing={formDoc}
          priorDocs={docs}
          isAdmin={isAdmin}
          onClose={() => setFormDoc(undefined)}
        />
      )}

      {viewDoc && (
        <DisciplineViewDialog
          doc={viewDoc}
          memberName={memberName}
          perspective="manager"
          isAdmin={isAdmin}
          currentMemberId={me?.id}
          onClose={() => setViewDoc(null)}
        />
      )}
    </div>
  );
}

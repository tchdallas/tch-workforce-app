import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';
import { FileText, NotebookPen, PenLine } from 'lucide-react';
import DisciplineViewDialog from './DisciplineViewDialog';
import { entryTypeLabel, DOC_STATUS, sentimentMeta } from './disciplineShared';

// "Documents" tab on My Profile (team member view): discipline documents to
// review/sign, signed history, and journal notes shared with them.
// RLS already scopes what this can see — drafts and unshared notes never arrive.
export default function MyDocumentsTab({ member }) {
  const { data: docs = [] } = useQuery({
    queryKey: ['my-discipline-docs', member.id],
    queryFn: () => base44.entities.DisciplineDocument.filter({ teamMemberId: member.id }),
    placeholderData: [],
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['my-journal-notes', member.id],
    queryFn: () => base44.entities.JournalEntry.filter({ teamMemberId: member.id }),
    placeholderData: [],
  });

  const pending = useMemo(() => docs.filter(d => d.status === 'issued'), [docs]);
  const history = useMemo(
    () => docs.filter(d => d.status !== 'issued')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [docs]
  );
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1)),
    [notes]
  );

  const [viewDoc, setViewDoc] = useState(null);
  const memberName = `${member.preferredName || member.firstName} ${member.lastName}`;

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <PenLine className="w-4 h-4 text-amber-500" /> Awaiting Your Signature
          </h3>
          <div className="space-y-2">
            {pending.map(d => (
              <Card key={d.id}
                    className="cursor-pointer border-amber-300 dark:border-amber-700 hover:bg-accent/40 transition-colors"
                    onClick={() => setViewDoc(d)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{entryTypeLabel(d.entryType)}</p>
                      <p className="text-xs text-muted-foreground">
                        Issued {d.issuedAt ? format(new Date(d.issuedAt), 'MMM d, yyyy') : ''} — tap to review and sign
                      </p>
                    </div>
                    <Badge className={`text-[10px] border-0 ${DOC_STATUS.issued.cls}`}>
                      {DOC_STATUS.issued.label}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
          <FileText className="w-4 h-4" /> My Documents
        </h3>
        <div className="space-y-1.5">
          {history.length === 0 && pending.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No documents on file.</p>
          )}
          {history.map(d => {
            const st = DOC_STATUS[d.status] || DOC_STATUS.issued;
            return (
              <button key={d.id}
                      className="w-full text-left border rounded-lg px-3 py-2 hover:bg-accent/40 transition-colors"
                      onClick={() => setViewDoc(d)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{entryTypeLabel(d.entryType)}
                    <span className="text-xs text-muted-foreground ml-2">
                      {format(parseISO(d.createdAt.slice(0, 10)), 'MMM d, yyyy')}
                    </span>
                  </span>
                  <Badge className={`text-[10px] border-0 ${st.cls}`}>{st.label}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {sortedNotes.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <NotebookPen className="w-4 h-4" /> Notes Shared With Me
          </h3>
          <div className="space-y-1.5">
            {sortedNotes.map(j => {
              const s = sentimentMeta(j.sentiment);
              return (
                <div key={j.id} className="border rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{format(parseISO(j.entryDate), 'MMM d, yyyy')}</span>
                    <Badge className={`text-[10px] border-0 ${s.cls}`}>{s.label}</Badge>
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{j.note}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {viewDoc && (
        <DisciplineViewDialog
          doc={viewDoc}
          memberName={memberName}
          perspective="member"
          isAdmin={false}
          currentMemberId={member.id}
          onClose={() => setViewDoc(null)}
        />
      )}
    </div>
  );
}

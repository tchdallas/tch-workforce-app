import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import {
  usePolicyComments, postPolicyComment, setCommentPinned, deletePolicyComment,
} from '@/lib/policies';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Pin, PinOff, Trash2, CornerDownRight, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Questions and answers about a policy, kept next to the policy. Two levels:
// top-level questions, and replies underneath. Pinned questions float to the
// top, which is how "the one everybody asks" stops being asked.
export default function PolicyThread({ policyId, canModerate }) {
  const qc = useQueryClient();
  const { member } = useCurrentMember();
  const { data: comments = [], isFetched } = usePolicyComments(policyId);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const { roots, repliesByParent } = useMemo(() => {
    const roots = [];
    const repliesByParent = new Map();
    comments.forEach(c => {
      if (c.parent_id) {
        if (!repliesByParent.has(c.parent_id)) repliesByParent.set(c.parent_id, []);
        repliesByParent.get(c.parent_id).push(c);
      } else {
        roots.push(c);
      }
    });
    // pinned first, then oldest-first so a conversation reads top to bottom
    roots.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || new Date(a.created_at) - new Date(b.created_at));
    return { roots, repliesByParent };
  }, [comments]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['policy-comments', policyId] });

  const submit = async (body, parentId, clear) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await postPolicyComment({ policyId, parentId, body });
      clear();
      refresh();
    } catch (e) {
      toast.error(e.message || 'Could not post that');
    } finally { setBusy(false); }
  };

  const togglePin = async (c) => {
    try { await setCommentPinned(c.id, !c.pinned); refresh(); }
    catch (e) { toast.error(e.message || 'Could not pin that'); }
  };

  const remove = async (c) => {
    try { await deletePolicyComment(c.id); refresh(); }
    catch (e) { toast.error(e.message || 'Could not remove that'); }
  };

  const Comment = ({ c, isReply }) => {
    const mine = c.created_by === member?.id;
    const deleted = !!c.deleted_at;
    return (
      <div className={cn('rounded-lg border border-border p-3', isReply && 'bg-muted/30')}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{c.author_name || 'Someone'}</span>
          {c.author_is_manager && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Manager</Badge>
          )}
          {c.pinned && !deleted && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1"><Pin className="w-2.5 h-2.5" /> Pinned</Badge>
          )}
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
          </span>
          {(canModerate || mine) && !deleted && (
            <span className="ml-auto flex items-center gap-0.5">
              {canModerate && !isReply && (
                <button
                  type="button" onClick={() => togglePin(c)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                  aria-label={c.pinned ? 'Unpin' : 'Pin to top'}
                  title={c.pinned ? 'Unpin' : 'Pin to top'}
                >
                  {c.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                type="button" onClick={() => remove(c)}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                aria-label="Remove" title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>

        {deleted
          ? <p className="text-sm mt-1.5 italic text-muted-foreground">This message was removed.</p>
          : <p className="text-sm mt-1.5 whitespace-pre-wrap break-words">{c.body}</p>}

        {!isReply && !deleted && (
          <button
            type="button"
            onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyDraft(''); }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <CornerDownRight className="w-3 h-3" /> Reply
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          placeholder="Ask a question about this policy, or add something the team should know…"
        />
        <div className="flex justify-end mt-2">
          <Button
            size="sm" className="gap-1.5"
            disabled={!draft.trim() || busy}
            onClick={() => submit(draft, null, () => setDraft(''))}
          >
            <Send className="w-3.5 h-3.5" /> Post
          </Button>
        </div>
      </div>

      {isFetched && roots.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No questions yet. Ask the first one.</p>
        </div>
      )}

      {roots.map(c => (
        <div key={c.id} className="space-y-2">
          <Comment c={c} />
          {(repliesByParent.get(c.id) || []).map(r => (
            <div key={r.id} className="ml-5">
              <Comment c={r} isReply />
            </div>
          ))}
          {replyTo === c.id && (
            <div className="ml-5 rounded-lg border border-border p-3">
              <Textarea
                value={replyDraft}
                onChange={e => setReplyDraft(e.target.value)}
                rows={2}
                placeholder="Write a reply…"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => setReplyTo(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!replyDraft.trim() || busy}
                  onClick={() => submit(replyDraft, c.id, () => { setReplyDraft(''); setReplyTo(null); })}
                >
                  Reply
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

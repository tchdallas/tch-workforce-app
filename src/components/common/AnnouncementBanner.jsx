import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Megaphone, ChevronRight } from 'lucide-react';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useMyAnnouncements } from '@/lib/announcements';

// Prompts the member to acknowledge any announcement that requires it. Shown at
// the top of the Dashboard so a required read can't be missed.
export default function AnnouncementBanner() {
  const navigate = useNavigate();
  const { member } = useCurrentMember();
  const { data: inbox = [] } = useMyAnnouncements(member?.id);
  const pending = inbox.filter(a => a.requires_acknowledgment && !a.acknowledgedAt);
  if (!pending.length) return null;

  const first = pending[0];
  return (
    <button
      onClick={() => navigate('/announcements')}
      className="w-full mb-6 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10 transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
        <Megaphone className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">
          {pending.length === 1 ? first.title : `${pending.length} announcements need your confirmation`}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {pending.length === 1 ? 'Tap to read and confirm' : 'Tap to review them'}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

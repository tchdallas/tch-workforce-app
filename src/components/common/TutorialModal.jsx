import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Sparkles, LayoutGrid, PanelsTopLeft, CalendarCheck, CalendarPlus, ClipboardList,
  Radio, Clock, Trophy, MessageSquare, Bell, Bug, ArrowRight, ArrowLeft, X, Check,
} from 'lucide-react';

// audience: 'all' shows to everyone; 'manager' only to managers+; 'member' only to team members.
const SLIDES = [
  { icon: Sparkles, title: 'Welcome to TCH Workforce', audience: 'all',
    body: "This is your home for schedules, shifts, time, and team communication — all in one place. Here's a quick tour of where everything lives. It takes about a minute." },
  { icon: PanelsTopLeft, title: 'Finding your way around', audience: 'all',
    body: "The menu is grouped into sections you can collapse to keep things tidy. On a phone, tap the ☰ button in the top-left to open it. The section for the page you're on always stays open." },
  { icon: LayoutGrid, title: 'Your dashboard', audience: 'all', path: '/',
    body: "“Needs Your Attention” surfaces anything waiting on you. Quick Actions are your shortcuts — tap Edit to choose which ones show and in what order." },
  { icon: CalendarCheck, title: 'Your schedule', audience: 'member', path: '/my-schedule',
    body: "“My Schedule” shows your upcoming shifts. When a shift is posted as open, you can claim it right from here or from Open Shifts." },
  { icon: CalendarPlus, title: 'Building the schedule', audience: 'manager', path: '/schedule',
    body: "The Schedule Builder is where you add shifts, use templates, and publish the week. Par-level and availability hints help you spot gaps and conflicts as you go." },
  { icon: ClipboardList, title: 'Requests & time off', audience: 'all', path: '/requests',
    body: "Request time off (paid or unpaid), trade a shift, or give one away. Managers review and approve everything on the Requests page." },
  { icon: Radio, title: 'The Live Roadmap', audience: 'all', path: '/roadmap',
    body: "See who's on the floor right now — clocked in, coming in next, running late, or called out — so you always know where coverage stands." },
  { icon: Clock, title: 'The time clock', audience: 'all',
    body: "Clock in and out at the kiosk with your badge, or from your phone if your role allows it. Managers review hours on Timesheets and export them to Paylocity." },
  { icon: Trophy, title: 'Tournament downs', audience: 'all', path: '/downs',
    body: "Managers log down cards and close out pay periods; dealers see their downs and what they earned right in their profile. Spot a problem? Raise a dispute." },
  { icon: MessageSquare, title: 'Talk to your team', audience: 'all', path: '/messages',
    body: "Send direct messages and group chats, and read Announcements from leadership — some ask you to confirm you've seen them." },
  { icon: Bell, title: 'Stay in the loop', audience: 'all', path: '/my-profile?tab=notifications',
    body: "The app can remind you about upcoming shifts and more. Fine-tune what you get under My Profile → Alerts." },
  { icon: Bug, title: 'Hit a snag? Tell us', audience: 'all',
    body: "The gold “Report a bug” button sits in the bottom-right on every screen. It grabs a screenshot and the details automatically — just say what happened and send." },
  { icon: Check, title: "You're all set", audience: 'all',
    body: "That's the tour. You can replay it anytime from the “?” button at the top of the screen. Welcome aboard!" },
];

export default function TutorialModal({ open, onClose }) {
  const navigate = useNavigate();
  const { isManager, isTeamMember } = useCurrentMember();
  const [i, setI] = useState(0);

  const slides = useMemo(() => SLIDES.filter((s) =>
    s.audience === 'all' ||
    (s.audience === 'manager' && isManager) ||
    (s.audience === 'member' && (isTeamMember || !isManager))
  ), [isManager, isTeamMember]);

  useEffect(() => { if (open) setI(0); }, [open]);

  const clamp = (n) => Math.max(0, Math.min(slides.length - 1, n));
  const last = i >= slides.length - 1;
  const slide = slides[i];

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setI((v) => clamp(v + 1));
      if (e.key === 'ArrowLeft') setI((v) => clamp(v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line

  if (!slide) return null;
  const Icon = slide.icon;

  const goThere = () => { onClose(); navigate(slide.path); };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0" data-bug-ignore="true">
        <button onClick={onClose} aria-label="Close tutorial"
          className="absolute right-3 top-3 z-10 text-muted-foreground hover:text-foreground p-1 rounded-md">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-10 pb-6 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'rgba(210,173,116,0.15)' }}>
            <Icon className="w-8 h-8" style={{ color: '#c69a54' }} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{slide.title}</h2>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed max-w-[36ch] mx-auto">{slide.body}</p>
          {slide.path && (
            <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={goThere}>
              Take me there <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 pb-4">
          {slides.map((_, idx) => (
            <button key={idx} onClick={() => setI(idx)} aria-label={`Go to step ${idx + 1}`}
              className={cn('h-1.5 rounded-full transition-all',
                idx === i ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50')} />
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/30">
          {i === 0 ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClose}>Skip</Button>
          ) : (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setI((v) => clamp(v - 1))}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          )}
          <span className="text-xs text-muted-foreground font-mono">{i + 1} / {slides.length}</span>
          {last ? (
            <Button size="sm" className="gap-1.5" onClick={onClose}><Check className="w-4 h-4" /> Done</Button>
          ) : (
            <Button size="sm" className="gap-1.5" onClick={() => setI((v) => clamp(v + 1))}>
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

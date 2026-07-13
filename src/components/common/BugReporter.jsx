import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { getRecentErrors } from '@/lib/errorLog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bug, Loader2, ChevronDown, Check, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const SEVERITIES = [
  { v: 'low', label: 'Minor', hint: 'Cosmetic or small annoyance' },
  { v: 'medium', label: 'Normal', hint: 'Something works wrong' },
  { v: 'high', label: 'Blocking', hint: "Can't do the task" },
];

const bundleVersion = () =>
  document.querySelector('script[src*="assets/index-"]')?.getAttribute('src') || 'dev';

// Capture just the current viewport (what the person is looking at). Returns a
// JPEG blob, or null if capture isn't possible on this page.
async function captureViewport() {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      useCORS: true,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      ignoreElements: (el) => el?.dataset?.bugIgnore === 'true',
    });
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.75));
  } catch {
    return null;
  }
}

const empty = { description: '', steps: '', expected: '', severity: 'medium' };

export default function BugReporter() {
  const location = useLocation();
  const { member } = useCurrentMember();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState(null); // { blob, url }
  const [includeShot, setIncludeShot] = useState(true);
  const [showTech, setShowTech] = useState(false);
  const [form, setForm] = useState(empty);
  const [inputFocused, setInputFocused] = useState(false);

  // Hide the floating button while someone is typing in a field, so it never
  // covers a page's own controls (e.g. the Messages send button on mobile).
  useEffect(() => {
    const editable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const onIn = (e) => { if (editable(e.target)) setInputFocused(true); };
    const onOut = () => setInputFocused(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  const openReporter = async () => {
    setForm(empty);
    setShowTech(false);
    setIncludeShot(true);
    setShot(null);
    setCapturing(true);
    setOpen(true);
    const blob = await captureViewport();
    setShot(blob ? { blob, url: URL.createObjectURL(blob) } : null);
    setCapturing(false);
  };

  const close = () => {
    setOpen(false);
    if (shot?.url) URL.revokeObjectURL(shot.url);
    setShot(null);
  };

  const submit = useMutation({
    mutationFn: async () => {
      let screenshotPath = null;
      if (includeShot && shot?.blob) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage
          .from('bug-screenshots')
          .upload(path, shot.blob, { contentType: 'image/jpeg' });
        if (!error) screenshotPath = path;
      }
      await base44.entities.BugReport.create({
        reporterId: member?.id || null,
        route: location.pathname,
        description: form.description.trim(),
        steps: form.steps.trim() || null,
        expected: form.expected.trim() || null,
        severity: form.severity,
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        appVersion: bundleVersion(),
        consoleLog: getRecentErrors(),
        screenshotPath,
      });
    },
    onSuccess: () => {
      toast.success('Thanks — your report was sent to the team.');
      close();
    },
    onError: (e) => toast.error(e?.message || 'Could not send the report — try again.'),
  });

  const handleSubmit = () => {
    if (!form.description.trim()) return toast.error('Please describe what went wrong.');
    submit.mutate();
  };

  const errCount = getRecentErrors().filter((e) => e.level === 'error').length;

  return (
    <>
      <button
        type="button"
        data-bug-ignore="true"
        onClick={openReporter}
        title="Report a bug"
        aria-label="Report a bug"
        className={cn(
          `fixed right-4 bottom-20 lg:bottom-6 z-40 flex items-center gap-2 h-11 pl-3 pr-4 rounded-full
          bg-foreground text-background shadow-lg border border-border/40
          hover:opacity-90 active:scale-95 transition-all text-sm font-medium`,
          inputFocused && 'hidden'
        )}
      >
        <Bug className="w-4 h-4" />
        <span className="hidden sm:inline">Report a bug</span>
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="max-w-lg" data-bug-ignore="true">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bug className="w-4 h-4" /> Report a bug</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">What went wrong? <span className="text-destructive">*</span></Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the problem in your own words."
                className="mt-1"
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">What were you doing?</Label>
              <Textarea
                value={form.steps}
                onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))}
                placeholder="The steps you took right before it happened."
                className="mt-1"
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">What did you expect to happen?</Label>
              <Input
                value={form.expected}
                onChange={(e) => setForm((f) => ({ ...f, expected: e.target.value }))}
                placeholder="Optional"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">How bad is it?</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {SEVERITIES.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, severity: s.v }))}
                    className={cn(
                      'rounded-md border px-2 py-2 text-left transition-colors',
                      form.severity === s.v
                        ? 'border-primary bg-primary/10'
                        : 'border-input hover:bg-accent/10'
                    )}
                  >
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-[10px] text-muted-foreground leading-tight">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Screenshot */}
            <div className="rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Screenshot of this screen</Label>
                {shot && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={includeShot} onChange={(e) => setIncludeShot(e.target.checked)} />
                    Include
                  </label>
                )}
              </div>
              <div className="mt-2">
                {capturing ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Capturing the screen…
                  </div>
                ) : shot ? (
                  <img
                    src={shot.url}
                    alt="Captured screen"
                    className={cn('w-full rounded-md border border-border max-h-40 object-cover object-top', !includeShot && 'opacity-40')}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <ImageOff className="w-4 h-4" /> Couldn't capture this screen — the report will still send.
                  </div>
                )}
              </div>
            </div>

            {/* Technical details (auto-attached) */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowTech((s) => !s)}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-muted-foreground"
              >
                <span>Technical details attached automatically</span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', showTech && 'rotate-180')} />
              </button>
              {showTech && (
                <div className="px-2.5 pb-2.5 text-[11px] text-muted-foreground font-mono space-y-1 border-t border-border pt-2">
                  <div>Page: {location.pathname}</div>
                  <div>Role: {member?.permissionLevel || '—'}</div>
                  <div>Screen: {window.innerWidth}×{window.innerHeight}</div>
                  <div>Recent errors captured: {errCount}</div>
                  <div className="truncate">Version: {bundleVersion()}</div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Send report</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

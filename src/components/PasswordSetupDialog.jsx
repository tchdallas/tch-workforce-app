import React, { useState } from 'react';
import { supabase } from '@/api/supabase';
import { useAuth } from '@/lib/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Shown right after someone arrives from an email link that signs them in
// without a password: an invite (magic link) or a password-reset link. The
// link's session is temporary — this is where the real password gets set.
export default function PasswordSetupDialog() {
  const { passwordSetup, finishPasswordSetup, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  if (!passwordSetup) return null;

  const invite = passwordSetup === 'invite';
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= 8 && password === confirm;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password set — you're signed in");
      finishPasswordSetup();
    } catch (e) {
      toast.error(e.message || 'Could not set the password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) finishPasswordSetup(); }}>
      <DialogContent className="max-w-sm" onKeyDown={e => { if (e.key === 'Enter') save(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> {invite ? 'Welcome — set your password' : 'Set a new password'}
          </DialogTitle>
          <DialogDescription>
            {invite
              ? `You're signed in from your invite${user?.email ? ` as ${user.email}` : ''}. Choose a password now so you can sign in anytime, from any device.`
              : `You followed a password-reset link${user?.email ? ` for ${user.email}` : ''}. Choose your new password to finish.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">New password</Label>
            <Input type="password" autoFocus autoComplete="new-password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Confirm password</Label>
            <Input type="password" autoComplete="new-password" value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password"
              className={mismatch ? 'mt-1 border-destructive focus-visible:ring-destructive' : 'mt-1'} />
          </div>
          {mismatch ? (
            <p className="text-xs text-destructive">Passwords don't match.</p>
          ) : tooShort ? (
            <p className="text-xs text-destructive">Password must be at least 8 characters.</p>
          ) : valid ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Passwords match.</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={finishPasswordSetup} disabled={saving}>
            {invite ? 'Skip for now' : 'Keep my old password'}
          </Button>
          <Button size="sm" onClick={save} disabled={!valid || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Save password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

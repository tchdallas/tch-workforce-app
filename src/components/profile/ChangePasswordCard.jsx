import React, { useState } from 'react';
import { supabase } from '@/api/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Set or change the account password. Useful for members who joined via an
// invite (magic link) and have no password yet, and for anyone changing theirs.
export default function ChangePasswordCard() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = password.length >= 8 && password === confirm;

  const save = async () => {
    if (password.length < 8) return toast.error('Use at least 8 characters');
    if (password !== confirm) return toast.error('Passwords do not match');
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password updated');
      setPassword(''); setConfirm('');
    } catch (e) {
      toast.error(e.message || 'Could not update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Set a password so you can sign in with your email anytime (not just from an invite link).
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">New password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div>
            <Label className="text-xs">Confirm password</Label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" />
          </div>
        </div>
        <Button size="sm" disabled={!valid || saving} onClick={save} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Update password
        </Button>
      </CardContent>
    </Card>
  );
}

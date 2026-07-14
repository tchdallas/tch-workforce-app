import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === 'setup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
      setBusy(true);
      try {
        const data = await signUp(email.trim(), password);
        if (!data.session) {
          setInfo('Almost done — check your email for a confirmation link, then come back and sign in.');
        }
        // with email confirmation off, the session starts immediately and the
        // auth listener takes over
      } catch (err) {
        setError(
          /already registered/i.test(err?.message || '')
            ? 'This email already has an account — use Sign in (or "Forgot password?").'
            : err?.message || 'Could not create your account.'
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(
        err?.message === 'Invalid login credentials'
          ? 'Incorrect email or password. First time here? Use "Set up your password" below.'
          : err?.message || 'Sign-in failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password?" again.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email.trim());
      setInfo('Password reset email sent - check your inbox.');
    } catch (err) {
      setError(err?.message || 'Could not send the reset email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-black mb-4 p-2.5">
            <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-full h-full" />
          </div>
          <h1 className="font-display text-3xl tracking-wide text-slate-900">TCH WORKFORCE</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'setup' ? 'Set up your account with your work email' : 'Sign in with your team account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white text-slate-900 rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@texascardhouse.com"
              className="placeholder:text-slate-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {mode === 'setup' && (
              <p className="text-[11px] text-slate-400">Use the email your manager has on file for you.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{mode === 'setup' ? 'Choose a password' : 'Password'}</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {mode === 'setup' && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
          )}
          {info && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">{info}</p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? (mode === 'setup' ? 'Creating account…' : 'Signing in…')
              : (mode === 'setup' ? 'Create my account' : 'Sign in')}
          </Button>

          {mode === 'signin' ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => switchMode('setup')}
                className="w-full text-center text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                First time here? Set up your password
              </button>
              <button
                type="button"
                onClick={handleForgot}
                disabled={busy}
                className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
              >
                Forgot password?
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
            >
              Already have an account? Sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

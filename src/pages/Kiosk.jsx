import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/api/supabase';
import { format } from 'date-fns';
import useVersionCheck from '@/hooks/useVersionCheck';

// Fullscreen time-clock kiosk. Runs signed in as a kiosk device account (or any
// manager+). Members punch by badge number; a webcam photo is captured with
// every punch and stored privately for timesheet review.
export default function Kiosk() {
  const [badge, setBadge] = useState('');
  const [result, setResult] = useState(null); // { action, name, time, hours }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraOk, setCameraOk] = useState(null); // null = starting
  const [now, setNow] = useState(new Date());
  // clock-in choice step: { badge, name, shifts, roles } after a badge scan
  const [options, setOptions] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const clearTimer = useRef(null);
  const chooseTimer = useRef(null);

  // kiosks run for weeks unattended — reload themselves when a deploy lands
  useVersionCheck({ auto: true });

  // live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setCameraOk(true);
      } catch {
        setCameraOk(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // attach the stream once the <video> is actually in the DOM (attaching
  // before it mounts silently produces a black preview)
  useEffect(() => {
    if (cameraOk && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOk]);

  const capturePhoto = useCallback(async () => {
    if (!cameraOk || !videoRef.current?.videoWidth) return null;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
      if (!blob) return null;
      const path = `punches/${format(new Date(), 'yyyy-MM-dd')}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('clock-photos').upload(path, blob, { contentType: 'image/jpeg' });
      return upErr ? null : path;
    } catch {
      return null;
    }
  }, [cameraOk]);

  const showResult = (data) => {
    setResult({
      action: data.action,
      name: data.name,
      role: data.role,
      clockIn: data.clock_in,
      clockOut: data.clock_out,
      time: format(new Date(data.action === 'out' ? data.clock_out : data.clock_in), 'h:mm:ss a'),
      hours: data.hours,
      breakMinutes: data.break_minutes,
      breakNote: data.break_note,
      unscheduled: data.unscheduled,
      scheduledStart: data.scheduled_start,
      lateMinutes: data.late_minutes,
    });
    // clock-out shows a fuller summary — leave it up longer
    clearTimer.current = setTimeout(() => setResult(null), data.action === 'out' ? 10000 : 6000);
  };

  const showError = (err) => {
    setError(err.message || 'Punch failed');
    clearTimer.current = setTimeout(() => setError(null), 5000);
  };

  const resetToBadge = () => {
    clearTimeout(chooseTimer.current);
    setOptions(null);
    setBadge('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Badge scan: clocked-in members punch straight out; clocking IN requires
  // choosing a gaming-day shift or an unscheduled role first
  const punch = async (e) => {
    e?.preventDefault();
    const b = badge.trim();
    if (!b || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    clearTimeout(clearTimer.current);
    try {
      const { data: opts, error: optErr } = await supabase.rpc('punch_options', { p_badge: b });
      if (optErr) throw optErr;
      if (opts.clocked_in) {
        const photo = await capturePhoto();
        const { data, error: rpcErr } = await supabase.rpc('punch_clock', { p_badge: b, p_photo: photo });
        if (rpcErr) throw rpcErr;
        showResult(data);
        setBadge('');
      } else {
        setOptions({ badge: b, name: opts.name, shifts: opts.shifts || [], roles: opts.roles || [] });
        // idle kiosks return to the badge screen on their own
        clearTimeout(chooseTimer.current);
        chooseTimer.current = setTimeout(resetToBadge, 45000);
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      if (!options) inputRef.current?.focus();
    }
  };

  const clockIn = async ({ shiftId, roleId }) => {
    if (busy || !options) return;
    setBusy(true);
    setError(null);
    clearTimeout(chooseTimer.current);
    try {
      const photo = await capturePhoto();
      const { data, error: rpcErr } = await supabase.rpc('punch_clock', {
        p_badge: options.badge,
        p_photo: photo,
        p_shift_id: shiftId || null,
        p_role_id: roleId || null,
      });
      if (rpcErr) throw rpcErr;
      showResult(data);
      resetToBadge();
    } catch (err) {
      showError(err);
      resetToBadge();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none">
      <img src="/tch-mark-gold.png" alt="Texas Card House" className="w-20 h-20 mb-3" />
      <h1 className="font-display text-4xl tracking-wider text-[#d2ad74]">TIME CLOCK</h1>
      <p className="text-2xl font-light mt-1 mb-6 tabular-nums">{format(now, 'EEEE, MMM d · h:mm:ss a')}</p>

      <div className="w-full max-w-sm space-y-4">
        <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-white/5 aspect-[4/3]">
          {cameraOk ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50 text-center px-6">
              {cameraOk === null ? 'Starting camera…' : 'No camera available — punches will be recorded without a photo'}
            </div>
          )}
        </div>

        {!options ? (
          <form onSubmit={punch} className="space-y-3">
            <input
              ref={inputRef}
              autoFocus
              inputMode="numeric"
              placeholder="Badge #"
              value={badge}
              onChange={e => setBadge(e.target.value)}
              className="w-full text-center text-3xl tracking-widest font-semibold bg-white/10 border border-white/20 rounded-xl px-4 py-4 outline-none focus:border-[#d2ad74] placeholder:text-white/30"
            />
            <button
              type="submit"
              disabled={busy || !badge.trim()}
              className="w-full py-4 rounded-xl bg-[#d2ad74] text-black font-display text-2xl tracking-wider disabled:opacity-40"
            >
              {busy ? 'ONE MOMENT…' : 'CLOCK IN / OUT'}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-lg">
              Hi <span className="font-semibold text-[#d2ad74]">{options.name}</span> — what are you clocking in for?
            </p>

            {options.shifts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-white/50 text-center">Your shifts today</p>
                {options.shifts.map(s => (
                  <button
                    key={s.id}
                    disabled={busy}
                    onClick={() => clockIn({ shiftId: s.id })}
                    className="w-full rounded-xl border border-[#d2ad74]/50 bg-[#d2ad74]/10 px-4 py-3 text-left hover:bg-[#d2ad74]/20 disabled:opacity-40"
                  >
                    <span className="font-semibold">{s.role || 'Shift'}</span>
                    <span className="text-white/70"> · {format(new Date(s.start_at), 'h:mm a')} – {format(new Date(s.end_at), 'h:mm a')}</span>
                    {s.location && <span className="block text-xs text-white/50 mt-0.5">{s.location}</span>}
                  </button>
                ))}
              </div>
            )}

            {options.roles.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-white/50 text-center">
                  {options.shifts.length > 0 ? 'Or start an unscheduled shift as' : 'No scheduled shift today — start an unscheduled shift as'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {options.roles.map(r => (
                    <button
                      key={r.id}
                      disabled={busy}
                      onClick={() => clockIn({ roleId: r.id })}
                      className="rounded-xl border border-white/20 bg-white/5 px-3 py-3 text-sm font-medium hover:bg-white/10 disabled:opacity-40"
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {options.shifts.length === 0 && options.roles.length === 0 && (
              <p className="text-center text-amber-300 text-sm">
                No shifts or roles are set up for you — please see a manager.
              </p>
            )}

            <button
              disabled={busy}
              onClick={resetToBadge}
              className="w-full py-3 rounded-xl border border-white/20 text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}

        {result && result.action === 'in' && (
          <div className="rounded-xl px-4 py-4 text-center bg-emerald-500/15 border border-emerald-500/40">
            <p className="font-display text-3xl tracking-wide">CLOCKED IN</p>
            <p className="text-lg mt-1">
              {result.name}{result.role ? <> · <span className="text-[#d2ad74] font-semibold">{result.role}</span></> : null}
            </p>
            <p className="text-sm text-white/70">{result.time}</p>
            {result.unscheduled && (
              <p className="text-sm text-amber-300 mt-0.5">No scheduled shift — recorded as unscheduled</p>
            )}
            {!result.unscheduled && result.breakMinutes > 0 && (
              <p className="text-sm text-white/70 mt-0.5">
                Break: {result.breakMinutes} min{result.breakNote ? ` — ${result.breakNote}` : ''}
              </p>
            )}
            {!result.unscheduled && result.lateMinutes != null && (
              <p className={`text-sm mt-0.5 ${result.lateMinutes > 5 ? 'text-red-300' : 'text-white/70'}`}>
                {result.lateMinutes > 5
                  ? `${result.lateMinutes} min late (scheduled ${format(new Date(result.scheduledStart), 'h:mm a')})`
                  : result.lateMinutes < -5
                    ? `${Math.abs(result.lateMinutes)} min early (scheduled ${format(new Date(result.scheduledStart), 'h:mm a')})`
                    : 'On time'}
              </p>
            )}
          </div>
        )}
        {result && result.action === 'out' && (
          <div className="rounded-xl px-4 py-4 bg-sky-500/15 border border-sky-500/40">
            <p className="font-display text-3xl tracking-wide text-center">CLOCKED OUT</p>
            <p className="text-lg mt-1 text-center">{result.name}</p>
            <div className="mt-3 space-y-1.5 text-sm border-t border-white/15 pt-3">
              <div className="flex justify-between gap-3">
                <span className="text-white/60">Clocked in{result.role ? ` as ${result.role}` : ''}</span>
                <span className="tabular-nums">{format(new Date(result.clockIn), 'h:mm:ss a')}</span>
              </div>
              {result.breakMinutes > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/60">Scheduled break</span>
                  <span>{result.breakMinutes} min{result.breakNote ? ` — ${result.breakNote}` : ''}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-white/60">Clocked out{result.role ? ` as ${result.role}` : ''}</span>
                <span className="tabular-nums">{format(new Date(result.clockOut), 'h:mm:ss a')}</span>
              </div>
              {result.hours != null && (
                <div className="flex justify-between gap-3 border-t border-white/15 pt-1.5 font-semibold">
                  <span>Total</span>
                  <span>{result.hours} hours</span>
                </div>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-xl px-4 py-4 text-center bg-red-500/15 border border-red-500/40">
            <p className="text-lg font-medium text-red-300">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

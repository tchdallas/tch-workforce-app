import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useMyNotificationPrefs, saveNotificationPref,
  NOTIF_EVENTS, LEAD_TIME_OPTIONS, DEFAULT_LEAD_TIMES,
} from '@/lib/notificationPrefs';

export default function NotificationPreferencesForm({ memberId }) {
  const qc = useQueryClient();
  const { data: prefs = {}, isLoading } = useMyNotificationPrefs(memberId);

  // local mirror so toggles feel instant; re-seed when the query loads/changes
  const [local, setLocal] = useState({});
  useEffect(() => { setLocal(prefs); }, [prefs]);

  const enabledOf = (key) => local[key]?.enabled !== false; // default on
  const leadsOf = (key) => local[key]?.settings?.lead_times_minutes || DEFAULT_LEAD_TIMES;

  const persist = async (key, patch) => {
    const next = {
      ...local,
      [key]: {
        event_type: key,
        enabled: patch.enabled !== undefined ? patch.enabled : enabledOf(key),
        settings: patch.settings !== undefined ? patch.settings : (local[key]?.settings || {}),
      },
    };
    setLocal(next);
    try {
      await saveNotificationPref(memberId, key, patch);
      qc.invalidateQueries({ queryKey: ['notification-prefs', memberId] });
    } catch (e) {
      toast.error(e.message || 'Could not save preference');
      setLocal(prefs); // revert
    }
  };

  const toggleEnabled = (key) => persist(key, { enabled: !enabledOf(key) });

  const toggleLead = (key, minutes) => {
    const current = leadsOf(key);
    let next = current.includes(minutes)
      ? current.filter(m => m !== minutes)
      : [...current, minutes];
    if (next.length === 0) return; // keep at least one while reminders are on
    next = next.sort((a, b) => b - a);
    persist(key, { settings: { ...(local[key]?.settings || {}), lead_times_minutes: next } });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;

  return (
    <Card className="p-4 space-y-1">
      <p className="text-xs text-muted-foreground mb-2">
        Choose which in-app notifications you receive. Changes save automatically.
      </p>
      {NOTIF_EVENTS.map((ev, i) => {
        const on = enabledOf(ev.key);
        return (
          <div key={ev.key} className={cn('py-3', i > 0 && 'border-t border-border')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{ev.label}</p>
                <p className="text-[11px] text-muted-foreground">{ev.desc}</p>
              </div>
              <Switch checked={on} onCheckedChange={() => toggleEnabled(ev.key)} />
            </div>

            {ev.key === 'upcoming_shift' && on && (
              <div className="mt-3">
                <p className="text-[11px] text-muted-foreground mb-1.5">Remind me before my shift:</p>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_TIME_OPTIONS.map(opt => {
                    const active = leadsOf(ev.key).includes(opt.minutes);
                    return (
                      <button
                        key={opt.minutes}
                        type="button"
                        onClick={() => toggleLead(ev.key, opt.minutes)}
                        className={cn(
                          'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-transparent text-muted-foreground border-border hover:bg-accent/10'
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

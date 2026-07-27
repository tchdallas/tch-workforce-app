import React, { useEffect, useState } from 'react';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { getPushState, enablePush, disablePush, needsInstallFirst } from '@/lib/push';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { BellRing, Share } from 'lucide-react';
import { toast } from 'sonner';

// Turns on alerts that arrive when the app is closed. Everything else in the
// app's notification system only reaches you while you're looking at it.
export default function PushNotificationCard() {
  const { member } = useCurrentMember();
  const [state, setState] = useState(null); // null = still checking
  const [busy, setBusy] = useState(false);

  useEffect(() => { getPushState().then(setState); }, []);

  const toggle = async (want) => {
    setBusy(true);
    try {
      setState(want ? await enablePush(member?.id) : await disablePush());
      toast.success(want ? 'Alerts on for this device' : 'Alerts off for this device');
    } catch (e) {
      toast.error(e.message || 'Could not change that');
      setState(await getPushState());
    } finally { setBusy(false); }
  };

  if (state === null) return null;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium flex items-center gap-2">
              <BellRing className="w-4 h-4 text-muted-foreground" /> Alerts on this device
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Shift reminders, hours needing your confirmation, and policy updates —
              delivered even when the app is closed. Each device is separate.
            </p>
          </div>
          {(state === 'on' || state === 'off') && (
            <Switch checked={state === 'on'} disabled={busy} onCheckedChange={toggle} />
          )}
        </div>

        {state === 'needs-install' && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs leading-relaxed">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <Share className="w-3.5 h-3.5" /> Add to your Home Screen first
            </p>
            <p className="text-muted-foreground mt-1">
              iPhone only delivers alerts to installed apps, not Safari tabs. Tap the
              Share button, choose <span className="text-foreground">Add to Home Screen</span>,
              then open TCH Workforce from your Home Screen and come back here.
            </p>
          </div>
        )}

        {state === 'denied' && (
          <p className="mt-3 text-xs text-amber-600 leading-relaxed">
            Notifications are blocked for this site. Turn them back on in your browser's
            site settings, then reload — the app can't re-ask once you've blocked it.
          </p>
        )}

        {state === 'unsupported' && (
          <p className="mt-3 text-xs text-muted-foreground">
            This browser doesn't support alerts. Try Chrome on Android, or install the
            app to your Home Screen on iPhone.
          </p>
        )}

        {state === 'on' && !needsInstallFirst() && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Only this device is set up. Turn it on separately on any other phone or computer you use.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

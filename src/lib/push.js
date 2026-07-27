import { supabase } from '@/api/supabase';

// Web Push, client side. The service worker (public/sw.js) receives the message;
// this file handles registration, permission, and keeping the subscription in
// sync with the push_subscriptions table.

// VAPID *public* key. This is meant to be embedded in the client — it's the
// identifier browsers use to verify our signature, not a secret. The matching
// private key lives only in Vercel's environment.
const VAPID_PUBLIC_KEY = 'BKKfT0kor-TGyITOD4LH_vUTDC5QWTla5AbsTXj9LLkpMpP_5-tDuxUjOdxKFyA8e6avd8IHw-kvO3c7BRTR1go';

const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

export const pushSupported = () =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

// Is this an installed app rather than a browser tab?
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  // iPadOS 13+ reports as Mac; the touch check separates it from a real Mac
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// On iPhone, push only works once the app has been added to the Home Screen —
// Safari tabs can't receive it at all. Worth saying out loud rather than
// letting someone tap Enable and get a silent failure.
export const needsInstallFirst = () => isIOS() && !isStandalone();

let registration = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registration;
  } catch {
    return null; // no SW means no push; the app itself is unaffected
  }
}

const getRegistration = async () => {
  if (registration) return registration;
  if (!('serviceWorker' in navigator)) return null;
  registration = await navigator.serviceWorker.ready;
  return registration;
};

// 'unsupported' | 'needs-install' | 'denied' | 'on' | 'off'
export async function getPushState() {
  if (!pushSupported()) return needsInstallFirst() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(memberId) {
  if (!memberId) throw new Error('Not signed in');
  if (needsInstallFirst()) {
    throw new Error('On iPhone, add TCH Workforce to your Home Screen first — Safari tabs can\'t receive alerts.');
  }
  if (!pushSupported()) throw new Error('This browser doesn\'t support notifications');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this site in your browser settings'
      : 'Notification permission was not granted');
  }

  const reg = await getRegistration();
  if (!reg) throw new Error('Could not start the notification service');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  // upsert on endpoint: re-enabling on the same device updates rather than
  // piling up duplicate rows that would each get their own copy of every alert
  const { error } = await supabase.from('push_subscriptions').upsert({
    team_member_id: memberId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return 'on';
}

export async function disablePush() {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    // best effort — if the row lingers, the sender prunes it on the next 410
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
  return 'off';
}

import { useEffect } from 'react';
import { toast } from 'sonner';

// A long-lived SPA tab keeps running old code through every deploy. This
// polls the served index.html (cheap: ~1KB, no-store) and compares the built
// bundle name against the one this tab loaded. On mismatch: prompt to update,
// or reload immediately (kiosks, where nobody reads toasts).
const currentBundle = () =>
  document.querySelector('script[src*="assets/index-"]')?.getAttribute('src');

export default function useVersionCheck({ auto = false, intervalMs = 5 * 60 * 1000 } = {}) {
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // dev server — no hashed bundle to compare

    let notified = false;
    const check = async () => {
      if (notified) return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        const html = await res.text();
        const latest = html.match(/[^"']*assets\/index-[^"']+\.js/)?.[0];
        if (!latest || latest === mine) return;
        notified = true;
        if (auto) {
          window.location.reload();
        } else {
          toast.info('A new version of TCH Workforce is available.', {
            id: 'app-update',
            duration: Infinity,
            action: { label: 'Update now', onClick: () => window.location.reload() },
          });
        }
      } catch {
        // offline or transient error — try again next tick
      }
    };

    const timer = setInterval(check, intervalMs);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [auto, intervalMs]);
}

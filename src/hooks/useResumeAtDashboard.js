import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

// Coming back after a real break should start you at the Dashboard, not on
// whatever screen you happened to close the app on three days ago.
//
// "A real break" is the whole trick. A browser tab or an installed PWA restores
// the last URL, so without this you resume mid-Timesheets from last Tuesday.
// But bouncing someone to the Dashboard because they glanced at a text message
// would be worse than the problem, so a heartbeat records when you were last
// actually here and only a long gap counts.
const LAST_SEEN_KEY = 'tch-last-seen';
const RESUME_AFTER_MINUTES = 30;
const HEARTBEAT_MS = 60 * 1000;

// Don't yank someone out of a form they're part-way through — same reasoning as
// the update prompt in useVersionCheck.
const modalOpen = () => !!document.querySelector(
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
);

const readLastSeen = () => {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const writeLastSeen = (email) => {
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ at: Date.now(), who: email || null }));
  } catch { /* private mode — resume just falls back to always redirecting */ }
};

export default function useResumeAtDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const checkedOnMount = useRef(false);
  // read the path through a ref so the heartbeat effect doesn't restart on
  // every navigation
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (checkedOnMount.current || !user?.email) return;
    checkedOnMount.current = true;

    const seen = readLastSeen();
    const gapTooLong = !seen?.at || (Date.now() - seen.at) > RESUME_AFTER_MINUTES * 60 * 1000;
    // a different person signing in on this device always starts fresh
    const differentUser = !!seen?.who && seen.who !== user.email;

    if ((gapTooLong || differentUser) && pathRef.current !== '/') {
      // replace, not push: the stale screen shouldn't sit in the back stack
      navigate('/', { replace: true });
    }
    writeLastSeen(user.email);
  }, [user?.email, navigate]);

  useEffect(() => {
    if (!user?.email) return;

    const beat = () => writeLastSeen(user.email);
    const timer = setInterval(beat, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        beat(); // stamp the moment they left
        return;
      }
      // Back from the background. An installed app often resumes without a page
      // load, so the mount check above never runs — this is the path that
      // actually catches "closed it and opened it again" on a phone.
      const seen = readLastSeen();
      const gap = seen?.at ? Date.now() - seen.at : Infinity;
      if (gap > RESUME_AFTER_MINUTES * 60 * 1000 && pathRef.current !== '/' && !modalOpen()) {
        navigate('/', { replace: true });
      }
      beat();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', beat);
    beat();

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', beat);
    };
  }, [user?.email, navigate]);
}

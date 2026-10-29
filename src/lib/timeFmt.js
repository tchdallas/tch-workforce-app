import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// Per-location clock format: '12h' (3:30 PM) or '24h' (15:30). Stored as the
// app_setting 'time_format' — location override falls back to company, then
// 12h. Every shift/schedule time in the app renders through these helpers so
// one Settings toggle changes the whole screen.
//
// Module-level cache so plain (non-hook) call sites like formatEndTime can
// read it; AppLayout mounts useTimeFormats() to keep it hydrated and to
// re-render the tree when the setting changes.
let settingsCache = [];
export function hydrateTimeFormats(settings) { settingsCache = settings || []; }

function formatOf(locationId) {
  const v =
    (locationId && settingsCache.find(s => s.key === 'time_format' && s.scope === 'location' && s.locationId === locationId)?.value)
    || settingsCache.find(s => s.key === 'time_format' && s.scope === 'company')?.value;
  return v === '24h' ? '24h' : '12h';
}

export const timePattern = (locationId) => (formatOf(locationId) === '24h' ? 'HH:mm' : 'h:mm a');
export const hourPattern = (locationId) => (formatOf(locationId) === '24h' ? 'HH:00' : 'h a');

export const fmtTime = (d, locationId) => format(new Date(d), timePattern(locationId));
export const fmtHour = (d, locationId) => format(new Date(d), hourPattern(locationId));

// "HH:mm" string (templates, par windows) → display string
export function fmtTimeStr(hhmm, locationId) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const d = new Date();
  d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  return fmtTime(d, locationId);
}

// Same key + fetch as every other app-settings query (shared react-query keys
// must use identical fetches). Hydrates the cache on every render.
export function useTimeFormats() {
  const { data = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  hydrateTimeFormats(data);
  return data;
}

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}


export const isIframe = window.self !== window.top;

// 24/7 clarity: end times of shifts that cross midnight get a next-day marker
// so "11:00 PM – 7:00 AM" can't be misread as the same day.
export function formatEndTime(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const nextDay = e.getFullYear() !== s.getFullYear() || e.getMonth() !== s.getMonth() || e.getDate() !== s.getDate();
  return format(e, 'h:mm a') + (nextDay ? ' (+1)' : '');
}

export function isOvernight(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return e.getFullYear() !== s.getFullYear() || e.getMonth() !== s.getMonth() || e.getDate() !== s.getDate();
}

// 24/7 grouping: which "business day" a datetime belongs to. With startHour 4,
// a shift starting at 1 AM Saturday groups under Friday — matching how a
// round-the-clock venue thinks about its days. Returns 'yyyy-MM-dd'.
export function businessDayOf(dateLike, startHour = 0) {
  const d = new Date(dateLike);
  d.setHours(d.getHours() - startHour);
  return format(d, 'yyyy-MM-dd');
}

// Shared labels/styles for the performance-documentation system.
// Mirrors the paper "Performance Documentation" form and the DB enums.

export const ENTRY_TYPES = [
  { value: 'informational', label: 'Informational Entry', short: 'Info' },
  { value: 'documented_coaching', label: 'Documented Coaching', short: 'DC' },
  { value: 'written_warning', label: 'Written Warning', short: 'WW' },
  { value: 'final_written_warning', label: 'Final Written Warning', short: 'FWW' },
  { value: 'suspension_pending_investigation', label: 'Suspension Pending Investigation', short: 'SPI', adminOnly: true },
  { value: 'separation', label: 'Separation of Employment', short: 'Separation', adminOnly: true },
];

export const entryTypeLabel = (v) => ENTRY_TYPES.find(t => t.value === v)?.label || v;

// Progressive ladder position. A doc counts toward the ladder once it's real
// (issued/signed/refused — drafts and voided docs don't advance anyone).
export const ENTRY_RANK = {
  informational: 0, documented_coaching: 1, written_warning: 2,
  final_written_warning: 3, suspension_pending_investigation: 4, separation: 5,
};
export const ladderStanding = (docs, natures = []) => {
  const counted = (docs || []).filter(d =>
    ['issued', 'acknowledged', 'refused'].includes(d.status)
    && (natures.length === 0 || (d.natures || []).some(n => natures.includes(n))));
  const highest = counted.reduce((m, d) => Math.max(m, ENTRY_RANK[d.entryType] ?? 0), -1);
  const next = ENTRY_TYPES[Math.min(highest + 1, ENTRY_TYPES.length - 1)].value;
  return { highest, next, counted };
};
export const entryTypeShort = (v) => ENTRY_TYPES.find(t => t.value === v)?.short || v;

export const NATURES = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'policy_performance', label: 'Policy / Performance' },
  { value: 'ethics_conduct', label: 'Ethics and Code of Conduct' },
];

export const natureLabel = (v) => NATURES.find(n => n.value === v)?.label || v;

export const DOC_STATUS = {
  draft:        { label: 'Draft', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  issued:       { label: 'Awaiting signature', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  acknowledged: { label: 'Signed', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  refused:      { label: 'Signature refused', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  voided:       { label: 'Voided', cls: 'bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500' },
};

export const SENTIMENTS = [
  { value: 'positive', label: 'Positive', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { value: 'neutral', label: 'Neutral', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  { value: 'negative', label: 'Negative', cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
];

export const sentimentMeta = (v) => SENTIMENTS.find(s => s.value === v) || SENTIMENTS[1];

// legal language lifted verbatim from the paper form
export const SIGNATURE_DISCLAIMER =
  "Team member's signature serves as recognition that the discussion occurred, and not as an agreement with the contents. " +
  'Failure to sign this document does not exclude the team member from this disciplinary action.';

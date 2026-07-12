// Termination taxonomy for turnover reporting. Category drives which reasons
// are offered; reasons are stored as their label text.

export const TERMINATION_CATEGORIES = [
  { value: 'voluntary', label: 'Voluntary' },
  { value: 'involuntary', label: 'Involuntary' },
];

export const TERMINATION_REASONS = {
  voluntary: [
    'Resignation',
    'Better opportunity',
    'Relocation',
    'Personal reasons',
    'Schedule / hours',
    'Pay',
    'Went back to school',
    'Retirement',
    'Other',
  ],
  involuntary: [
    'Performance',
    'Attendance',
    'No-call / no-show',
    'Misconduct',
    'Policy violation',
    'Layoff / reduction',
    'End of seasonal / temp',
    'Other',
  ],
};

export const categoryLabel = (v) =>
  TERMINATION_CATEGORIES.find(c => c.value === v)?.label || 'Unspecified';

// Where a notification should take you when clicked. Returns a route or null
// (some notices are purely informational). Used by the Notifications page and
// the live toast's "View" action — keep the two in sync by keeping this the
// only place that knows the mapping.
export function notificationLink(n) {
  switch (n.relatedEntityType) {
    case 'conversation':
      return `/messages?c=${n.relatedEntityId}`;
    case 'announcement':
      return '/announcements';
    case 'discipline_document':
    case 'journal_entry':
      return '/my-profile?tab=documents';
    case 'attendance_infraction':
      // admins get appeal-filed notices and review them on the Attendance page;
      // members' point notices land on the dashboard (appeal lives in Needs
      // Your Attention)
      return n.type === 'attendance_appeal_filed' ? '/attendance' : '/';
    case 'callout':
      return '/callouts';
    case 'down_dispute':
      return '/downs';
    case 'bug_report':
      return '/bug-reports';
    case 'policy':
      return n.relatedEntityId ? `/policies/${n.relatedEntityId}` : '/policies';
    default:
      break;
  }
  switch (n.type) {
    case 'schedule_updated':
    case 'upcoming_shift':
      return '/my-schedule';
    case 'shift_offered':
      return '/open-shifts';
    case 'request_status':
      return '/my-profile?tab=timeoff';
    case 'timesheet':
      return '/timesheets';
    case 'message_received':
      return '/messages';
    default:
      return null;
  }
}

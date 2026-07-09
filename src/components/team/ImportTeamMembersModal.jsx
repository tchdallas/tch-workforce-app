import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle, XCircle, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const REQUIRED = ['firstName', 'lastName', 'email'];
// badgeNumber = the Paylocity Badge Number (stored as the member's TM#) —
// keep this column list compatible with a future Paylocity API sync
const EXPECTED_COLUMNS = [
  'badgeNumber', 'firstName', 'lastName', 'preferredName', 'email', 'phone',
  'dateOfBirth', 'address', 'city', 'state', 'zip', 'startDate', 'status',
  'permissionLevel', 'homeLocationName', 'assignedLocationNames', 'assignedRoleNames',
  'emergencyContactName', 'emergencyContactPhone',
];
const PERMISSION_LEVELS = ['super_admin', 'corporate_admin', 'location_admin', 'manager', 'scheduler', 'team_member'];
const BATCH_SIZE = 100;

// Recognize common Paylocity (and generic HR export) column names so the file
// can be uploaded as-exported. Keys are lowercased with non-letters stripped.
const HEADER_ALIASES = {
  badgenumber: 'badgeNumber', badge: 'badgeNumber', badgeid: 'badgeNumber', badgeno: 'badgeNumber',
  employeeid: 'badgeNumber', employeenumber: 'badgeNumber', tmnumber: 'badgeNumber', empid: 'badgeNumber',
  firstname: 'firstName', first: 'firstName', legalfirstname: 'firstName',
  lastname: 'lastName', last: 'lastName', legallastname: 'lastName',
  preferredname: 'preferredName', nickname: 'preferredName', goesby: 'preferredName',
  email: 'email', workemail: 'email', emailaddress: 'email', companyemail: 'email',
  phone: 'phone', phonenumber: 'phone', mobilephone: 'phone', cellphone: 'phone', homephone: 'phone',
  dateofbirth: 'dateOfBirth', dob: 'dateOfBirth', birthdate: 'dateOfBirth', birthday: 'dateOfBirth',
  address: 'address', addressline: 'address', streetaddress: 'address', address1: 'address',
  city: 'city', state: 'state', zip: 'zip', zipcode: 'zip', postalcode: 'zip',
  startdate: 'startDate', hiredate: 'startDate', originalhiredate: 'startDate',
  status: 'status', employeestatus: 'status',
  permissionlevel: 'permissionLevel',
  homelocationname: 'homeLocationName', homelocation: 'homeLocationName', location: 'homeLocationName',
  worklocation: 'homeLocationName', costcenter: 'homeLocationName',
  assignedlocationnames: 'assignedLocationNames', locations: 'assignedLocationNames',
  assignedrolenames: 'assignedRoleNames', roles: 'assignedRoleNames', jobtitle: 'assignedRoleNames', position: 'assignedRoleNames',
  emergencycontactname: 'emergencyContactName', emergencycontact: 'emergencyContactName',
  emergencycontactphone: 'emergencyContactPhone',
};

const canonicalHeader = (h) => {
  const key = h.toLowerCase().replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] || h;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strict date parsing: YYYY-MM-DD or MM/DD/YYYY only.
// Returns ISO string, undefined for blank, or null for invalid.
function normalizeDate(v) {
  const raw = (v || '').trim();
  if (!raw) return undefined;
  let y, mo, d;
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [, y, mo, d] = m;
  else {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) [y, mo, d] = [m[3], m[1], m[2]];
  }
  if (!y) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00');
  if (isNaN(dt) || dt.getMonth() + 1 !== Number(mo) || dt.getDate() !== Number(d)) return null;
  return iso;
}

function parseCSV(text) {
  // lines starting with # are reference/comment lines (the template ships with
  // them) — ignored entirely
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => canonicalHeader(h.trim().replace(/^"|"$/g, '')));
  const rows = lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return headers.reduce((obj, h, i) => { obj[h] = values[i] || ''; return obj; }, {});
  });
  return { headers, rows };
}

// Small delay to avoid rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default function ImportTeamMembersModal({ open, onClose, onImported }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState(null); // { succeeded, failed, importedIds }
  const fileInputRef = useRef();

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list(),
    placeholderData: [],
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list(),
    placeholderData: [],
  });

  // ALL members including archived — dedup must see everyone, and archived
  // matches get revived on re-import (own cache key: the shared 'teamMembers'
  // key excludes archived members)
  const { data: existingMembers = [] } = useQuery({
    queryKey: ['teamMembers-all'],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 0,
    placeholderData: [],
  });

  const downloadTemplate = () => {
    const activeLocations = locations.filter(l => l.status === 'active');
    const activeRoles = roles.filter(r => r.status === 'active');
    const locationNames = activeLocations.slice(0, 2).map(l => l.name).join(';') || 'Main Location;Downtown';
    const firstLoc = activeLocations[0]?.name || 'Main Location';
    const firstRole = activeRoles[0]?.name || 'Dealer';

    // Reference block: lines starting with # are ignored by the importer, so
    // this can stay in the file when it's uploaded
    const reference = [
      '# TCH Workforce — Team Member Import Template',
      '# Lines starting with # are ignored. Fill one row per person below the header.',
      '#',
      `# Available locations (for homeLocationName / assignedLocationNames): ${activeLocations.map(l => l.name).join('; ') || '(none created yet — add locations in the app first)'}`,
      `# Available roles (for assignedRoleNames): ${activeRoles.map(r => r.name).join('; ') || '(none created yet — add roles in the app first)'}`,
      '# Valid status values: active; inactive; invited (blank = active)',
      `# Valid permissionLevel values: ${PERMISSION_LEVELS.join('; ')} (blank = team_member)`,
      '# Date format (dateOfBirth, startDate): YYYY-MM-DD or MM/DD/YYYY',
      '# Multiple locations/roles: separate with ; inside quotes, e.g. "Location A;Location B"',
      '#',
    ].join('\n');

    const header = EXPECTED_COLUMNS.join(',');
    const example = [
      '12345', 'Jane', 'Doe', 'Jane', 'jane@example.com', '555-1234',
      '1995-04-12', '100 Main St', 'Austin', 'TX', '78701', '2026-01-15', 'active',
      'team_member', firstLoc, `"${locationNames}"`, `"${firstRole}"`,
      'John Doe', '555-5678',
    ].join(',');
    const csv = `${reference}\n${header}\n${example}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team_members_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(parseCSV(ev.target.result));
    reader.readAsText(f);
  };

  // strict: every name must match an existing record — unknowns reject the row
  const resolveIdsStrict = (namesStr, list) => {
    const ids = [];
    const missing = [];
    (namesStr || '').split(';').map(n => n.trim()).filter(Boolean).forEach(name => {
      const match = list.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (match) ids.push(match.id);
      else missing.push(name);
    });
    return { ids, missing };
  };

  const unknownColumns = preview
    ? preview.headers.filter(h => !EXPECTED_COLUMNS.includes(h))
    : [];

  const handleImport = async () => {
    if (!preview?.rows?.length) return;
    setImporting(true);
    setImportProgress(0);
    const failed = [];
    const importedIds = [];

    // Validate everything up front so batches contain only clean rows
    // (a single bad row would otherwise reject its whole database batch).
    // Archived members matching by email are REVIVED, not rejected — so a
    // corrected file can simply be re-imported after an "Undo Import".
    const activeMembers = existingMembers.filter(m => m.status !== 'archived');
    const archivedByEmail = new Map(
      existingMembers.filter(m => m.status === 'archived')
        .map(m => [(m.email || '').trim().toLowerCase(), m])
    );
    const activeByEmail = new Map(activeMembers.map(m => [(m.email || '').trim().toLowerCase(), m]));
    // badge -> owner's email, so a member's own badge doesn't read as a conflict
    const badgeOwner = new Map(
      activeMembers.filter(m => m.tmNumber?.trim())
        .map(m => [m.tmNumber.trim().toLowerCase(), (m.email || '').trim().toLowerCase()])
    );
    const fileEmails = new Set();
    const fileBadges = new Set();
    const clean = [];
    const revive = [];
    const updates = [];
    const unchanged = [];

    // does the file actually change anything on this member? (blank cells are
    // "no opinion" — they never overwrite existing data)
    const norm = (v) => (v === undefined || v === null) ? '' : Array.isArray(v) ? [...v].sort().join(',') : String(v);
    const payloadDiffers = (existing, payload) =>
      Object.entries(payload).some(([k, v]) => v !== undefined && norm(v) !== norm(existing[k]));

    for (const row of preview.rows) {
      const badge = (row.badgeNumber ?? row.tmNumber ?? '').trim(); // accept either header
      const email = (row.email || '').trim().toLowerCase();
      if (!row.firstName || !row.lastName || !email) {
        failed.push({ row, reason: 'Missing required fields (firstName, lastName, email)' });
        continue;
      }
      const badgeKey = badge.toLowerCase();
      if (fileEmails.has(email)) {
        failed.push({ row, reason: `Duplicate row in file for "${row.email}"` });
        continue;
      }
      if (badge && fileBadges.has(badgeKey)) {
        failed.push({ row, reason: `Badge # "${badge}" appears twice in the file` });
        continue;
      }
      if (badge && badgeOwner.has(badgeKey) && badgeOwner.get(badgeKey) !== email) {
        failed.push({ row, reason: `Badge # "${badge}" belongs to another team member` });
        continue;
      }

      // Strict validation: any unknown or malformed value rejects the row
      const problems = [];
      if (!EMAIL_RE.test(email)) problems.push(`invalid email "${row.email}"`);

      const dateOfBirth = normalizeDate(row.dateOfBirth);
      if (dateOfBirth === null) problems.push(`invalid dateOfBirth "${row.dateOfBirth}" (use YYYY-MM-DD or MM/DD/YYYY)`);
      const startDate = normalizeDate(row.startDate);
      if (startDate === null) problems.push(`invalid startDate "${row.startDate}" (use YYYY-MM-DD or MM/DD/YYYY)`);

      const rawStatus = (row.status || '').trim().toLowerCase();
      if (rawStatus && !['active', 'inactive', 'invited', 'archived'].includes(rawStatus)) {
        problems.push(`unknown status "${row.status}"`);
      }
      const rawPerm = (row.permissionLevel || '').trim().toLowerCase();
      if (rawPerm && !PERMISSION_LEVELS.includes(rawPerm)) {
        problems.push(`unknown permissionLevel "${row.permissionLevel}"`);
      }

      const homeName = (row.homeLocationName || '').trim();
      const homeLocation = homeName
        ? locations.find(l => l.name.toLowerCase() === homeName.toLowerCase())
        : undefined;
      if (homeName && !homeLocation) problems.push(`unknown location "${homeName}"`);

      const locRes = resolveIdsStrict(row.assignedLocationNames, locations);
      if (locRes.missing.length) problems.push(`unknown location(s): ${locRes.missing.join(', ')}`);
      const roleRes = resolveIdsStrict(row.assignedRoleNames, roles);
      if (roleRes.missing.length) problems.push(`unknown role(s): ${roleRes.missing.join(', ')}`);

      if (problems.length) {
        failed.push({ row, reason: problems.join('; ') });
        continue;
      }

      fileEmails.add(email);
      if (badge) fileBadges.add(badgeKey);
      const archivedMatch = archivedByEmail.get(email);
      const activeMatch = activeByEmail.get(email);

      const payload = {
        tmNumber: badge || undefined,
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName || undefined,
        email: row.email.trim(),
        phone: row.phone || undefined,
        dateOfBirth,
        address: row.address || undefined,
        city: row.city || undefined,
        state: row.state || undefined,
        zip: row.zip || undefined,
        startDate,
        status: rawStatus || undefined,           // blank = leave as-is / DB default
        permissionLevel: rawPerm || undefined,    // blank = leave as-is / DB default
        emergencyContactName: row.emergencyContactName || undefined,
        emergencyContactPhone: row.emergencyContactPhone || undefined,
        homeLocationId: homeLocation?.id || undefined,
        assignedLocationIds: locRes.ids.length ? locRes.ids : undefined,
        assignedRoleIds: roleRes.ids.length ? roleRes.ids : undefined,
      };

      if (activeMatch) {
        // existing member: apply any new info from the file; skip if identical
        if (payloadDiffers(activeMatch, payload)) updates.push({ row, updateId: activeMatch.id, payload });
        else unchanged.push(row);
      } else if (archivedMatch) {
        revive.push({ row, reviveId: archivedMatch.id, payload: { ...payload, status: rawStatus || 'active' } });
      } else {
        clean.push({ row, payload });
      }
    }

    // Revive archived members that reappear in the file (fresh data, back to active)
    const succeeded = [];
    for (let i = 0; i < revive.length; i += 10) {
      const chunk = revive.slice(i, i + 10);
      await Promise.all(chunk.map(async (b) => {
        try {
          await base44.entities.TeamMember.update(b.reviveId, b.payload);
          importedIds.push(b.reviveId);
          succeeded.push(b.row);
        } catch (err) {
          failed.push({ row: b.row, reason: err.message || 'Could not restore archived member' });
        }
      }));
    }

    // Apply new info to members who already exist (NOT reversed by Undo Import)
    const updatedRows = [];
    for (let i = 0; i < updates.length; i += 10) {
      const chunk = updates.slice(i, i + 10);
      await Promise.all(chunk.map(async (b) => {
        try {
          await base44.entities.TeamMember.update(b.updateId, b.payload);
          updatedRows.push(b.row);
        } catch (err) {
          failed.push({ row: b.row, reason: err.message || 'Could not update existing member' });
        }
      }));
    }

    // Import new members in batches of 100; if a batch fails, retry its rows
    // one by one so a single problem row doesn't sink the other 99
    for (let i = 0; i < clean.length; i += BATCH_SIZE) {
      const batch = clean.slice(i, i + BATCH_SIZE);
      try {
        const created = await base44.entities.TeamMember.bulkCreate(batch.map(b => b.payload));
        created.forEach(c => importedIds.push(c.id));
        batch.forEach(b => succeeded.push(b.row));
      } catch {
        for (const b of batch) {
          try {
            const created = await base44.entities.TeamMember.create(b.payload);
            importedIds.push(created.id);
            succeeded.push(b.row);
          } catch (err) {
            failed.push({ row: b.row, reason: err.message || 'Unknown error' });
          }
        }
      }
      setImportProgress(Math.round(Math.min(100, ((i + batch.length) / clean.length) * 100)));
    }

    setImportProgress(100);
    // keep our all-members cache fresh so a follow-up import diffs correctly
    queryClient.invalidateQueries({ queryKey: ['teamMembers-all'] });
    setResults({ succeeded, updated: updatedRows, unchanged, failed, importedIds });
    setImporting(false);
    if (succeeded.length > 0 || updatedRows.length > 0) {
      const parts = [];
      if (succeeded.length) parts.push(`${succeeded.length} imported`);
      if (updatedRows.length) parts.push(`${updatedRows.length} updated`);
      toast.success(parts.join(', '));
      onImported?.(importedIds);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreview(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Team Members via CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!results && (
            <>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Upload a CSV file. Required fields marked <span className="text-red-500">*</span>.</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {EXPECTED_COLUMNS.map(col => (
                    <Badge key={col} variant="secondary" className="text-xs font-mono">
                      {col}{REQUIRED.includes(col) && <span className="text-red-500 ml-0.5">*</span>}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Use <code className="bg-muted px-1 rounded">;</code> to separate multiple location/role names (e.g. <code className="bg-muted px-1 rounded">Main;Downtown</code>)
                </p>
              </div>

              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
              >
                <Download className="w-3 h-3" /> Download CSV Template
              </button>

              {/* Valid values, straight from the database — anything else is rejected */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-[11px] uppercase tracking-wide text-muted-foreground">Valid values</p>
                <p>
                  <span className="font-medium">Locations:</span>{' '}
                  {locations.filter(l => l.status === 'active').map(l => l.name).join(' · ') || <span className="text-amber-600">none yet — create locations first</span>}
                </p>
                <p>
                  <span className="font-medium">Roles:</span>{' '}
                  {roles.filter(r => r.status === 'active').map(r => r.name).join(' · ') || <span className="text-amber-600">none yet — create roles first</span>}
                </p>
                <p><span className="font-medium">Status:</span> active · inactive · invited <span className="text-muted-foreground">(blank = active)</span></p>
                <p><span className="font-medium">Permission:</span> {PERMISSION_LEVELS.join(' · ')} <span className="text-muted-foreground">(blank = team_member)</span></p>
                <p><span className="font-medium">Dates:</span> YYYY-MM-DD or MM/DD/YYYY</p>
              </div>

              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to select a CSV file</p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {preview && preview.rows.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium mb-1">{preview.rows.length} row{preview.rows.length > 1 ? 's' : ''} detected</p>
                  <p className="text-xs text-muted-foreground">Columns: {preview.headers.join(', ')}</p>
                </div>
              )}
              {unknownColumns.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm">
                  <p className="font-medium text-red-700 dark:text-red-400 mb-1">
                    Unrecognized column{unknownColumns.length > 1 ? 's' : ''}: {unknownColumns.join(', ')}
                  </p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80">
                    The file can't be imported until every column is recognized — remove or rename
                    these in the file and re-upload. (Download the template above for valid names.)
                  </p>
                </div>
              )}
              {importing && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Importing records…</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {results && (() => {
            // group non-imports by category; skips are informational, not failures
            const categorize = (reason) => {
              if (/Badge #|Duplicate row/.test(reason)) return 'Duplicate badge or row';
              if (/Missing required/.test(reason)) return 'Missing name or email';
              if (/invalid email/.test(reason)) return 'Invalid email';
              if (/invalid dateOfBirth|invalid startDate/.test(reason)) return 'Invalid date format';
              if (/unknown location/.test(reason)) return 'Unknown location';
              if (/unknown role/.test(reason)) return 'Unknown role';
              if (/unknown status/.test(reason)) return 'Unknown status';
              if (/unknown permissionLevel/.test(reason)) return 'Unknown permission level';
              return 'Other errors';
            };
            const errorGroups = {};
            results.failed.forEach(f => {
              const cat = categorize(f.reason);
              (errorGroups[cat] = errorGroups[cat] || []).push(f);
            });
            const errorCount = results.failed.length;

            return (
              <div className="space-y-3">
                {results.succeeded.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600">
                    <CheckCircle className="w-4 h-4" />
                    <span>{results.succeeded.length} imported successfully</span>
                  </div>
                )}
                {results.updated?.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-sky-500">
                    <CheckCircle className="w-4 h-4" />
                    <span>{results.updated.length} updated with new info from the file</span>
                  </div>
                )}
                {results.unchanged?.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 opacity-50" />
                    <span>{results.unchanged.length} unchanged — already up to date</span>
                  </div>
                )}
                {errorCount > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-red-500">
                      <XCircle className="w-4 h-4" />
                      <span>{errorCount} rejected</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1.5">
                      {Object.entries(errorGroups)
                        .sort((a, b) => b[1].length - a[1].length)
                        .map(([cat, rows]) => (
                          <details key={cat} className="rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                            <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium">
                              {rows.length} × {cat}
                            </summary>
                            <div className="px-2 pb-1.5 space-y-0.5">
                              {rows.map((f, i) => (
                                <p key={i} className="text-[11px]">
                                  <span className="font-medium">{f.row.firstName} {f.row.lastName}</span>: {f.reason}
                                </p>
                              ))}
                            </div>
                          </details>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <DialogFooter>
          {results ? (
            <>
              <p className="text-xs text-muted-foreground mr-auto">Use "Undo Import" in the page header to reverse this.</p>
              <Button variant="outline" onClick={handleClose}>Close</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={!preview?.rows?.length || importing || unknownColumns.length > 0}>
                {importing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Importing… {importProgress}%</>
                ) : (
                  `Import ${preview?.rows?.length || 0} Members`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
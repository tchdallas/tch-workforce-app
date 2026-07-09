import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Download, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

// Parse the Paylocity CSV format (skip header rows 1-4, row 5 has column names)
function parsePaylocityCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Find the data header row (contains "ID" as first column)
  const headerIndex = lines.findIndex(l => l.startsWith('ID,') || l.replace(/^[^,]*,/, '').startsWith('Employee Name'));
  if (headerIndex === -1) return { headers: [], rows: [] };

  const headers = lines[headerIndex].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    const row = headers.reduce((obj, h, idx) => { obj[h] = values[idx] || ''; return obj; }, {});
    // Only include rows that have an ID (skip blank/summary rows)
    if (row['ID'] && /^\d+$/.test(row['ID'].trim())) {
      rows.push(row);
    }
  }
  return { headers, rows };
}

// Parse date + time strings from Paylocity format
// date: "4/27/2026", time: " 9:00AM" or "10:00AM"
function parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const datePart = dateStr.trim(); // e.g. "4/27/2026"
  const timePart = timeStr.trim(); // e.g. "9:00AM" or "1:00AM"
  const combined = `${datePart} ${timePart}`;
  // Parse M/D/YYYY h:mmAM
  const match = combined.match(/(\d+)\/(\d+)\/(\d{4})\s+(\d+):(\d+)(AM|PM)/i);
  if (!match) return null;
  let [, month, day, year, hour, minute, ampm] = match;
  hour = parseInt(hour);
  minute = parseInt(minute);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const dt = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, minute, 0);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default function ImportPaylocityModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // { rows }
  const [preview, setPreview] = useState(null); // analyzed rows with match status
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState(null);
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
  // same key as the roster REQUIRES the same fetch (filtered, no archived) —
  // a different queryFn under a shared key silently overwrites the cache
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.filter(
      { status: { $in: ['active', 'invited', 'inactive'] } }, 'firstName'
    ),
    placeholderData: [],
  });

  const resolveTeamMember = (row) => {
    const id = row['ID']?.trim();
    const name = row['Employee Name']?.trim();
    // Match by tmNumber first
    if (id) {
      const byTm = teamMembers.find(m => m.tmNumber?.trim() === id);
      if (byTm) return byTm;
    }
    // Fall back to name match
    if (name) {
      const [first, ...rest] = name.split(' ');
      const last = rest.join(' ');
      const byName = teamMembers.find(m =>
        m.firstName?.toLowerCase() === first?.toLowerCase() &&
        m.lastName?.toLowerCase() === last?.toLowerCase()
      );
      if (byName) return byName;
    }
    return null;
  };

  const resolveLocation = (row) => {
    const cc4 = row['CC4 Name']?.trim();
    if (!cc4) return null;
    return locations.find(l => l.name?.toLowerCase() === cc4.toLowerCase()) || null;
  };

  const resolveRole = (row) => {
    const cc3 = row['CC3 Name']?.trim();
    if (!cc3) return null;
    return roles.find(r => r.name?.toLowerCase() === cc3.toLowerCase()) || null;
  };

  const analyzeRows = (rows) => {
    const skipped = new Map(); // id/name -> reason
    const valid = [];
    rows.forEach((row, i) => {
      const tm = resolveTeamMember(row);
      if (!tm) {
        const key = `${row['ID']} — ${row['Employee Name']}`;
        if (!skipped.has(key)) skipped.set(key, `ID ${row['ID']} (${row['Employee Name']}) not found in system`);
        return;
      }
      const startDT = parseDateTime(row['Scheduled Start Date'], row['Scheduled Start Time']);
      const endDT = parseDateTime(row['Scheduled End Date'], row['Scheduled End time']);
      if (!startDT || !endDT) {
        valid.push({ row, tm, status: 'warning', reason: 'Could not parse shift times' });
        return;
      }
      const location = resolveLocation(row);
      const role = resolveRole(row);
      valid.push({ row, tm, startDT, endDT, location, role, status: 'ok' });
    });
    return { valid, skipped: [...skipped.values()] };
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setResults(null);
    setPreview(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows } = parsePaylocityCSV(ev.target.result);
      setParsed({ rows });
      const { valid, skipped } = analyzeRows(rows);
      setPreview({ valid, skipped, total: rows.length });
    };
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    setImportProgress(0);
    const validRows = preview.valid.filter(v => v.status === 'ok');
    const succeeded = [];
    const failed = [];

    for (let i = 0; i < validRows.length; i++) {
      setImportProgress(Math.round((i / validRows.length) * 100));
      const { row, tm, startDT, endDT, location, role } = validRows[i];
      if (i > 0 && i % 5 === 0) await sleep(500);
      try {
        await base44.entities.Shift.create({
          teamMemberId: tm.id,
          locationId: location?.id || tm.homeLocationId || undefined,
          roleId: role?.id || undefined,
          startDateTime: startDT,
          endDateTime: endDT,
          status: 'draft',
          shiftType: 'assigned',
          coverageStatus: 'covered',
        });
        succeeded.push(row);
      } catch (err) {
        failed.push({ row, reason: err.message || 'Unknown error' });
      }
    }

    setImportProgress(100);
    setResults({ succeeded, failed, skipped: preview.skipped });
    setImporting(false);

    if (succeeded.length > 0) {
      toast.success(`Imported ${succeeded.length} shift${succeeded.length > 1 ? 's' : ''} as drafts`);
      onImported?.();
    }
  };

  const handleClose = () => {
    setFile(null);
    setParsed(null);
    setPreview(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const downloadTemplate = () => {
    // Mimics the exact Paylocity "Display Schedule" CSV export format
    const header = 'TCH CORPORATE LLC,,,,MM/DD/YYYY - MM/DD/YYYY,,,,,\n';
    const subHeader = 'DisplaySchedule,,,,As of: today,,,,,\n';
    const blank1 = ',,,,Sort By: ,,,,,\n';
    const blank2 = ',,,,,,,,,\n';
    const colHeader = 'ID,Employee Name,Scheduled Start Date,Scheduled Start Time,Scheduled End Date,Scheduled End time,CC1 Name,CC2 Name,CC3 Name,CC4 Name\n';
    const example1 = '1001,John Smith,5/20/2026, 9:00AM,5/20/2026, 5:00PM,Dallas,Operations,Dealer,TCH Dallas\n';
    const example2 = '1002,Jane Doe,5/20/2026, 2:00PM,5/20/2026,10:00PM,Las Colinas,Operations,Dealer,TCH Social Las Colinas\n';
    const csv = header + subHeader + blank1 + blank2 + colHeader + example1 + example2;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'paylocity_schedule_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = preview?.valid.filter(v => v.status === 'ok').length ?? 0;
  const skippedCount = (preview?.skipped.length ?? 0) + (preview?.valid.filter(v => v.status === 'warning').length ?? 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Paylocity Schedule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!results && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Upload a Paylocity <strong>"Display Schedule"</strong> CSV export. Shifts are created as <strong>drafts</strong> and matched by <strong>TM # (Employee ID)</strong>. Unrecognized employees are skipped.
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
                >
                  <Download className="w-3 h-3" /> Download CSV Template
                </button>
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
                  <p className="text-sm text-muted-foreground">Click to select a Paylocity CSV file</p>
                )}
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </div>

              {preview && (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
                    <p className="font-medium">{preview.total} schedule rows found</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                        <CheckCircle className="w-3 h-3 mr-1" />{validCount} ready to import
                      </Badge>
                      {skippedCount > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                          <AlertTriangle className="w-3 h-3 mr-1" />{skippedCount} will be skipped
                        </Badge>
                      )}
                    </div>
                  </div>

                  {preview.skipped.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Unrecognized employees (will be skipped):
                      </p>
                      <div className="max-h-36 overflow-y-auto space-y-1 rounded border bg-amber-50 dark:bg-amber-900/10 p-2">
                        {/* Deduplicate skipped entries */}
                        {[...new Set(preview.skipped)].map((msg, i) => (
                          <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{msg}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {importing && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Creating shifts…</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {results && (
            <div className="space-y-3">
              {results.succeeded.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>{results.succeeded.length} shift{results.succeeded.length > 1 ? 's' : ''} imported as drafts</span>
                </div>
              )}
              {results.failed.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-red-500">
                    <XCircle className="w-4 h-4" />
                    <span>{results.failed.length} failed to create</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {results.failed.map((f, i) => (
                      <div key={i} className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded px-2 py-1">
                        <span className="font-medium">{f.row['Employee Name']}</span>: {f.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {results.skipped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {results.skipped.length} employee{results.skipped.length > 1 ? 's' : ''} skipped (not in system):
                  </p>
                  <div className="max-h-36 overflow-y-auto space-y-1 rounded border bg-amber-50 dark:bg-amber-900/10 p-2">
                    {[...new Set(results.skipped)].map((msg, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{msg}</p>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Imported shifts are in <strong>Draft</strong> status — review and publish from the Schedule page.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {results ? (
            <Button variant="outline" onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={!preview || validCount === 0 || importing}>
                {importing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Importing… {importProgress}%</>
                ) : (
                  `Import ${validCount} Shift${validCount !== 1 ? 's' : ''}`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
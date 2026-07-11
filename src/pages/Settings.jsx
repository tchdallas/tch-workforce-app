import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import AttendancePolicySection from '@/components/settings/AttendancePolicySection';
import { useLocations } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { toast } from 'sonner';
import { Globe } from 'lucide-react';

const SETTING_KEYS = [
  { key: 'company_name', label: 'Company Name', type: 'text', tab: 'general', companyOnly: true },
  { key: 'default_shift_start', label: 'Default Shift Start', type: 'text', placeholder: 'e.g. 09:00', tab: 'general' },
  { key: 'default_shift_end', label: 'Default Shift End', type: 'text', placeholder: 'e.g. 17:00', tab: 'general' },
  { key: 'shift_swap_approval', label: 'Require Manager Approval for Trades & Giveaways', type: 'swapApproval', tab: 'approvals', description: 'If off, a qualified recipient can accept directly — the shift transfers immediately. This is enforced by the database either way.' },
  { key: 'require_manager_approval_timeoff', label: 'Require Manager Approval for Time Off', type: 'toggle', tab: 'approvals' },
  { key: 'business_day_start_hour', label: 'Business Day Starts At', type: 'hourSelect', tab: 'rules', description: 'For 24/7 scheduling: shifts starting before this hour group with the previous day (e.g. a 1 AM shift shows under Friday night, not Saturday)' },
  { key: 'mobile_clock_in', label: 'Allow Mobile Clock-In', type: 'jsonToggle', tab: 'rules', description: 'Team members at this scope can clock in/out from their own phone. Individual roles can also enable it (Roles page). Everyone can always use the kiosk.' },
  { key: 'paylocity_detcode', label: 'Paylocity Earnings Code (DETCODE)', type: 'text', placeholder: 'REG', tab: 'general', description: 'Used in the Timesheets export' },
  { key: 'default_shift_hours', label: 'Default Shift Length (hours)', type: 'text', placeholder: '8', tab: 'rules', description: 'New shifts end this many hours after their start time. Individual roles can override this (Roles page).' },
  { key: 'overtime_threshold_hours', label: 'OT Warning Threshold (hours/week)', type: 'text', placeholder: '40', tab: 'rules' },
  { key: 'max_consecutive_days', label: 'Max Consecutive Days', type: 'text', placeholder: '6', tab: 'rules' },
  { key: 'open_shift_auto_approve', label: 'Auto-Approve Open Shift Claims', type: 'toggle', tab: 'rules' },
  { key: 'giveaway_max_hours_per_day', label: 'Block Giveaway if Recipient Exceeds (hours/day)', type: 'text', placeholder: 'e.g. 10 (leave blank to disable)', tab: 'rules' },
  { key: 'giveaway_max_hours_per_week', label: 'Block Giveaway if Recipient Exceeds (hours/week)', type: 'text', placeholder: 'e.g. 40 (leave blank to disable)', tab: 'rules' },
  { key: 'giveaway_block_if_recent_callout', label: 'Block if Team Member Called Out in Last 24 Hours', type: 'toggle', tab: 'rules', description: 'Prevents team members from receiving a shift if they submitted a callout in the past 24 hours' },
  { key: 'giveaway_block_if_on_leave', label: 'Block if Team Member Has Approved Time Off', type: 'toggle', tab: 'rules', description: 'Prevents team members from receiving a shift if they have approved time off overlapping that shift' },
  { key: 'roadmap_refresh_interval', label: 'Roadmap Auto-Refresh (seconds)', type: 'text', placeholder: '60', tab: 'roadmap' },
  { key: 'roadmap_show_tips', label: 'Show Tip Tracking on Roadmap', type: 'toggle', tab: 'roadmap' },
];

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { member, isAdmin, assignedLocationIds } = useCurrentMember();

  const { data: rawSettings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });

  const activeLocations = useMemo(
    () => locations.filter(l => l.status === 'active' &&
      (assignedLocationIds.length === 0 || assignedLocationIds.includes(l.id))),
    [locations, assignedLocationIds]
  );

  // Scope selection: company-wide (exclusive) OR one-or-more locations
  const [companyScope, setCompanyScope] = useState(true);
  const [selectedLocations, setSelectedLocations] = useState([]);

  // Drop any selected locations the user can no longer access
  useEffect(() => {
    setSelectedLocations(prev => prev.filter(id => activeLocations.some(l => l.id === id)));
  }, [activeLocations]);

  const scopes = useMemo(() => {
    if (companyScope) return [{ scope: 'company' }];
    return selectedLocations.map(id => ({ scope: 'location', locationId: id }));
  }, [companyScope, selectedLocations]);

  const scopeLabel = companyScope
    ? 'All Locations'
    : selectedLocations.length === 0
      ? 'No location selected'
      : selectedLocations.length === 1
        ? (activeLocations.find(l => l.id === selectedLocations[0])?.name || '1 location')
        : `${selectedLocations.length} locations`;

  // Value helpers
  const getCompanyVal = (key) => rawSettings.find(s => s.key === key && s.scope === 'company')?.value || '';
  const getLocationVal = (key, locId) =>
    rawSettings.find(s => s.key === key && s.scope === 'location' && s.locationId === locId)?.value || '';
  const getEffectiveVal = (key, locId) => {
    const v = getLocationVal(key, locId);
    return v !== '' && v !== undefined ? v : getCompanyVal(key);
  };

  // Display value for the currently selected scope
  const getDisplayVal = (key) => {
    if (companyScope) return getCompanyVal(key);
    if (selectedLocations.length === 1) return getEffectiveVal(key, selectedLocations[0]);
    return getCompanyVal(key); // multiple locations → company base to apply
  };

  const isOverridden = (key) => {
    if (companyScope || selectedLocations.length !== 1) return false;
    return getLocationVal(key, selectedLocations[0]) !== '';
  };

  // Drafts (local edits)
  const [drafts, setDrafts] = useState({});
  const getDraft = (key) => (drafts[key] !== undefined ? drafts[key] : getDisplayVal(key));
  const setDraft = (key, val) => setDrafts(d => ({ ...d, [key]: val }));

  // Clear drafts when scope changes so inputs reflect the new scope's values
  useEffect(() => { setDrafts({}); }, [companyScope, selectedLocations.join(',')]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, value }) => {
      if (scopes.length === 0) throw new Error('Select at least one location');
      for (const sc of scopes) {
        const existing = sc.scope === 'company'
          ? rawSettings.find(s => s.key === key && s.scope === 'company')
          : rawSettings.find(s => s.key === key && s.scope === 'location' && s.locationId === sc.locationId);
        if (existing) {
          await base44.entities.AppSetting.update(existing.id, { value });
        } else {
          const payload = { key, value, scope: sc.scope };
          if (sc.scope === 'location') payload.locationId = sc.locationId;
          await base44.entities.AppSetting.create(payload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      toast.success(`Saved — applied to ${scopeLabel}`);
    },
    onError: (e) => toast.error(e.message || 'Could not save'),
  });

  const toggleLocation = (id) => {
    setCompanyScope(false);
    setSelectedLocations(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleCompany = (v) => {
    setCompanyScope(v);
    if (v) setSelectedLocations([]);
  };

  const renderSetting = (s) => {
    const overridden = isOverridden(s.key);
    if (s.type === 'hourSelect') {
      const current = String(getDraft(s.key) || '0');
      return (
        <div key={s.key} className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
          <div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">{s.label}</Label>
              {overridden && <Badge variant="secondary" className="text-[10px]">Location override</Badge>}
            </div>
            {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
          </div>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shrink-0"
            value={current}
            disabled={scopes.length === 0}
            onChange={(e) => {
              setDraft(s.key, e.target.value);
              saveMutation.mutate({ key: s.key, value: e.target.value });
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6].map(h => (
              <option key={h} value={String(h)}>
                {h === 0 ? '12 AM (midnight)' : `${h} AM`}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (s.type === 'jsonToggle') {
      // stored as jsonb {"enabled": true|false}
      const checked = getDraft(s.key)?.enabled === true;
      return (
        <div key={s.key} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">{s.label}</Label>
              {overridden && <Badge variant="secondary" className="text-[10px]">Location override</Badge>}
            </div>
            {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
          </div>
          <Switch
            checked={checked}
            disabled={scopes.length === 0}
            onCheckedChange={(v) => {
              const value = { enabled: v };
              setDraft(s.key, value);
              saveMutation.mutate({ key: s.key, value });
            }}
          />
        </div>
      );
    }
    if (s.type === 'swapApproval') {
      // stored as jsonb {"mode": "none" | "all" | "roles"} — the database's
      // approval-routing trigger reads this same value
      const val = getDraft(s.key);
      const checked = val?.mode === 'all' || val?.mode === 'roles';
      return (
        <div key={s.key} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">{s.label}</Label>
              {overridden && <Badge variant="secondary" className="text-[10px]">Location override</Badge>}
            </div>
            {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
          </div>
          <Switch
            checked={checked}
            disabled={scopes.length === 0}
            onCheckedChange={(v) => {
              const value = { mode: v ? 'all' : 'none' };
              setDraft(s.key, value);
              saveMutation.mutate({ key: s.key, value });
            }}
          />
        </div>
      );
    }
    if (s.type === 'toggle') {
      const checked = getDraft(s.key) === 'true';
      return (
        <div key={s.key} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">{s.label}</Label>
              {overridden && <Badge variant="secondary" className="text-[10px]">Location override</Badge>}
            </div>
            {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
          </div>
          <Switch
            checked={checked}
            disabled={scopes.length === 0}
            onCheckedChange={(v) => {
              setDraft(s.key, String(v));
              saveMutation.mutate({ key: s.key, value: String(v) });
            }}
          />
        </div>
      );
    }
    return (
      <div key={s.key} className="py-3 border-b border-border last:border-0">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-xs text-muted-foreground">{s.label}</Label>
          {overridden && <Badge variant="secondary" className="text-[10px]">Location override</Badge>}
        </div>
        <div className="flex gap-2">
          <Input
            value={getDraft(s.key)}
            placeholder={s.placeholder}
            onChange={e => setDraft(s.key, e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={scopes.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ key: s.key, value: getDraft(s.key) })}
          >
            Save
          </Button>
        </div>
      </div>
    );
  };

  // the attendance policy is the company rulebook — super admins only
  const isSuperAdmin = member?.permissionLevel === 'super_admin';
  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'rules', label: 'Shift Rules' },
    { id: 'roadmap', label: 'Roadmap' },
    ...(isSuperAdmin ? [{ id: 'attendance', label: 'Attendance Policy' }] : []),
  ];

  // The database rejects non-admin writes regardless; this hides the page
  // from anyone who navigates here directly (nav links are already filtered)
  if (member && !isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-sm text-muted-foreground">Settings are only available to admins.</p>
      </div>
    );
  }
  if (!member) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Configure by location or company-wide" />

      {/* Scope selector */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Apply settings to</h2>
            <Badge variant="outline" className="text-xs ml-auto">{scopeLabel}</Badge>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
              <Checkbox checked={companyScope} onCheckedChange={(v) => toggleCompany(!!v)} />
              <span className="text-sm font-medium">All Locations (company-wide default)</span>
            </label>
            <div className={companyScope ? 'opacity-50 pointer-events-none' : ''}>
              <p className="text-[11px] text-muted-foreground mb-1 px-2">Or select specific locations:</p>
              <div className="grid sm:grid-cols-2 gap-1">
                {activeLocations.map(l => (
                  <label key={l.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={selectedLocations.includes(l.id)}
                      onCheckedChange={() => toggleLocation(l.id)}
                    />
                    <span className="text-sm">{l.name}</span>
                  </label>
                ))}
                {activeLocations.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2">No active locations available.</p>
                )}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Company-wide values are the default for every location. Selecting a location lets you override it; picking multiple locations applies the same value to each.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          {tabs.map(t => <TabsTrigger key={t.id} value={t.id} className="text-xs">{t.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map(t => (
          <TabsContent key={t.id} value={t.id}>
            {t.id === 'attendance' ? (
              <AttendancePolicySection />
            ) : (
              <Card>
                <CardContent className="p-6">
                  {SETTING_KEYS.filter(s => s.tab === t.id).map(renderSetting)}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

    </div>
  );
}
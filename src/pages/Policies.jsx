import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import { usePolicies, useOutstandingPolicyAcks, usePolicyCategories } from '@/lib/policies';
import PageHeader from '@/components/common/PageHeader';
import PolicyEditorDialog from '@/components/policies/PolicyEditorDialog';
import FilterGroup from '@/components/common/FilterGroup';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollText, Plus, Search, ChevronRight, AlertCircle, Filter, ArrowUpDown, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_META = {
  published: 'Published',
  draft: 'Draft',
  pending_approval: 'Pending approval',
  archived: 'Archived',
};
// Everything except archived — the default view hides archived policies.
const DEFAULT_STATUS = ['published', 'draft', 'pending_approval'];
const STATUS_ORDER = ['published', 'pending_approval', 'draft', 'archived'];

export default function Policies() {
  const { member, isManager, scopeLocations } = useCurrentMember();
  const { data: policies = [], isFetched } = usePolicies();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: outstanding } = useOutstandingPolicyAcks(member?.id);
  const { data: categories = [] } = usePolicyCategories();
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);

  // filters + sort
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [locationFilter, setLocationFilter] = useState([]);
  const [sortBy, setSortBy] = useState('title'); // title | updated
  const [sortDir, setSortDir] = useState('asc');
  const toggleIn = (setter) => (v) =>
    setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const categoryName = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const categoryRank = useMemo(() => Object.fromEntries(categories.map((c, i) => [c.name, i])), [categories]);
  const roleName = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r.name])), [roles]);
  const locationName = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l.name])), [locations]);

  // Filter options built from what's actually here (so team members, who only
  // ever see published policies, don't get a pile of irrelevant status options).
  const presentStatuses = useMemo(() => new Set(policies.map(p => p.status)), [policies]);
  const statusOptions = STATUS_ORDER
    .filter(s => presentStatuses.has(s))
    .map(s => ({ value: s, label: STATUS_META[s] }));
  const usedCategoryIds = useMemo(() => {
    const s = new Set();
    policies.forEach(p => (p.categoryIds || []).forEach(id => s.add(id)));
    return s;
  }, [policies]);
  const categoryOptions = categories.filter(c => usedCategoryIds.has(c.id)).map(c => ({ value: c.id, label: c.name }));
  const locationOptions = scopeLocations(locations.filter(l => l.status === 'active')).map(l => ({ value: l.id, label: l.name }));

  const needsMe = useMemo(() => {
    const s = new Set();
    (outstanding?.policies || []).forEach(p => s.add(p.policyId));
    (outstanding?.updates || []).forEach(u => s.add(u.policyId));
    return s;
  }, [outstanding]);

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => policies.filter(p => {
    if (statusFilter.length && !statusFilter.includes(p.status)) return false;
    if (categoryFilter.length && !(p.categoryIds || []).some(id => categoryFilter.includes(id))) return false;
    if (locationFilter.length && !(p.locationIds || []).some(id => locationFilter.includes(id))) return false;
    if (term) {
      const hay = `${p.title} ${(p.categoryIds || []).map(id => categoryName[id] || '').join(' ')} ${p.summary || ''} ${p.body || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }), [policies, statusFilter, categoryFilter, locationFilter, term, categoryName]);

  const sortItems = (arr) => {
    const val = (p) => sortBy === 'updated' ? (p.updated_at || p.created_at || '') : p.title.toLowerCase();
    const s = [...arr].sort((a, b) => String(val(a)).localeCompare(String(val(b)), undefined, { sensitivity: 'base', numeric: true }));
    return sortDir === 'asc' ? s : s.reverse();
  };

  // Group by category, uncategorised last; a policy in several categories appears
  // under each. Items within a group follow the chosen sort.
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach(p => {
      const names = (p.categoryIds || []).map(id => categoryName[id]).filter(Boolean);
      const keys = names.length ? names : ['Uncategorised'];
      keys.forEach(key => {
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(p);
      });
    });
    return [...m.entries()]
      .map(([k, items]) => [k, sortItems(items)])
      .sort(([a], [b]) => {
        if (a === 'Uncategorised') return 1;
        if (b === 'Uncategorised') return -1;
        const ra = categoryRank[a] ?? Number.MAX_SAFE_INTEGER;
        const rb = categoryRank[b] ?? Number.MAX_SAFE_INTEGER;
        return ra !== rb ? ra - rb : a.localeCompare(b);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, categoryName, categoryRank, sortBy, sortDir]);

  const statusChanged = statusFilter.length !== DEFAULT_STATUS.length || !DEFAULT_STATUS.every(s => statusFilter.includes(s));
  const activeFilterCount = (statusChanged ? 1 : 0) + (categoryFilter.length ? 1 : 0) + (locationFilter.length ? 1 : 0);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Policies & Procedures" subtitle="How we do things, and what changed recently">
        {!!member && isManager && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditorOpen(true)}>
            <Plus className="w-4 h-4" /> New policy
          </Button>
        )}
      </PageHeader>

      {needsMe.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/60 bg-primary/5 px-3 py-2 mb-3 text-sm">
          <AlertCircle className="w-4 h-4 text-primary shrink-0" />
          <span>
            {needsMe.size === 1
              ? '1 policy needs your confirmation.'
              : `${needsMe.size} policies need your confirmation.`}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-input flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
            placeholder="Search policies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
              <Filter className="w-4 h-4" /> Filter
              {activeFilterCount > 0 && (
                <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 leading-tight">{activeFilterCount}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
              <FilterGroup title="Status" options={statusOptions} selected={statusFilter} onToggle={toggleIn(setStatusFilter)} />
              <FilterGroup title="Category" options={categoryOptions} selected={categoryFilter} onToggle={toggleIn(setCategoryFilter)} />
              <FilterGroup title="Club" options={locationOptions} selected={locationFilter} onToggle={toggleIn(setLocationFilter)} />
            </div>
            {activeFilterCount > 0 && (
              <div className="border-t border-border p-2">
                <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs"
                  onClick={() => { setStatusFilter(DEFAULT_STATUS); setCategoryFilter([]); setLocationFilter([]); }}>
                  <X className="w-3.5 h-3.5" /> Reset filters
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
              <ArrowUpDown className="w-4 h-4" /> Sort
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            {[['title', 'Title'], ['updated', 'Recently updated']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setSortBy(v)}
                className={cn('w-full flex items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-muted', sortBy === v && 'text-primary font-medium')}>
                {l} {sortBy === v && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
            <div className="border-t border-border my-1" />
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted">
              {sortDir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {isFetched && policies.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No policies published for your roles yet.</p>
        </div>
      )}

      {isFetched && policies.length > 0 && visible.length === 0 && (
        <p className="text-center py-10 text-sm text-muted-foreground">
          {term ? `Nothing matches “${search}”.` : 'No policies match your filters.'}
        </p>
      )}

      <div className="space-y-5">
        {groups.map(([category, items]) => (
          <div key={category}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
              {category}
            </h2>
            <div className="space-y-2">
              {items.map(p => (
                <Link key={p.id} to={`/policies/${p.id}`} className="block">
                  <Card className={cn(
                    'p-3 hover:bg-muted/40 transition-colors',
                    needsMe.has(p.id) && 'border-primary/60 ring-1 ring-primary/20'
                  )}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">{p.title}</h3>
                          {p.status === 'draft' && <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
                          {p.status === 'pending_approval' && <Badge className="text-[10px] border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Pending approval</Badge>}
                          {p.status === 'archived' && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                          {needsMe.has(p.id) && <Badge className="text-[10px]">Action needed</Badge>}
                        </div>
                        {p.summary && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.summary}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          {audienceLine(p, roleName, locationName)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <PolicyEditorDialog open={editorOpen} onClose={() => setEditorOpen(false)} policy={null} />
    </div>
  );
}

// "Dealer, Floor · Dallas" — trimmed so a policy covering everything doesn't
// render a paragraph of names in the list.
function audienceLine(p, roleName, locationName) {
  const names = (ids, lookup) => {
    const list = ids.map(id => lookup[id]).filter(Boolean);
    if (list.length === 0) return null;
    if (list.length <= 2) return list.join(', ');
    return `${list[0]}, ${list[1]} +${list.length - 2}`;
  };
  const r = names(p.roleIds || [], roleName);
  const l = names(p.locationIds || [], locationName);
  return [r, l].filter(Boolean).join(' · ') || 'No audience set';
}

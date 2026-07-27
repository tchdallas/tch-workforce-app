import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import { usePolicies, useOutstandingPolicyAcks, usePolicyCategories } from '@/lib/policies';
import PageHeader from '@/components/common/PageHeader';
import PolicyEditorDialog from '@/components/policies/PolicyEditorDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollText, Plus, Search, ChevronRight, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Policies() {
  const { member, isManager } = useCurrentMember();
  const { data: policies = [], isFetched } = usePolicies();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: outstanding } = useOutstandingPolicyAcks(member?.id);
  const { data: categories = [] } = usePolicyCategories();
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);

  // category order follows the managed list, so headings read in the order
  // someone deliberately arranged rather than alphabetically by accident
  const categoryName = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const categoryRank = useMemo(() => Object.fromEntries(categories.map((c, i) => [c.name, i])), [categories]);
  const roleName = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r.name])), [roles]);
  const locationName = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l.name])), [locations]);

  // Which policies still want something from me — drives the "Action needed" flag
  const needsMe = useMemo(() => {
    const s = new Set();
    (outstanding?.policies || []).forEach(p => s.add(p.policyId));
    (outstanding?.updates || []).forEach(u => s.add(u.policyId));
    return s;
  }, [outstanding]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? policies.filter(p =>
        p.title.toLowerCase().includes(term)
        || (p.categoryIds || []).some(id => (categoryName[id] || '').toLowerCase().includes(term))
        || (p.summary || '').toLowerCase().includes(term)
        || (p.body || '').toLowerCase().includes(term))
    : policies;

  // Group by category, uncategorised last. A policy in several categories is
  // listed under each — that's the point of allowing more than one.
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
    return [...m.entries()].sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1;
      if (b === 'Uncategorised') return -1;
      const ra = categoryRank[a] ?? Number.MAX_SAFE_INTEGER;
      const rb = categoryRank[b] ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  }, [visible, categoryName, categoryRank]);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Policies & Procedures" subtitle="How we do things, and what changed recently">
        {/* strict !!member: isManager is optimistically true while the member row
            loads, which would flash "New policy" at a dealer */}
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

      <div className="flex items-center gap-1.5 h-10 px-3 rounded-md border border-input mb-4">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
          placeholder="Search policies…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isFetched && policies.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No policies published for your roles yet.</p>
        </div>
      )}

      {isFetched && policies.length > 0 && visible.length === 0 && (
        <p className="text-center py-10 text-sm text-muted-foreground">Nothing matches “{search}”.</p>
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

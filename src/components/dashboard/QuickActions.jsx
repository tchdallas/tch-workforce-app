import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Settings2, ArrowUp, ArrowDown, X, Plus, RotateCcw } from 'lucide-react';
import { quickActionCatalog, defaultQuickActions } from '@/components/layout/navConfig';
import { useUiPrefs } from '@/hooks/useUiPrefs';

// Each user chooses which shortcut buttons appear here and in what order; the
// choice is stored per person in the DB (useUiPrefs), so it follows them to
// any device. The catalog is drawn from the nav config so it's always
// permission-correct.
export default function QuickActions({ isManager, isAdmin }) {
  const catalog = useMemo(() => quickActionCatalog({ isManager, isAdmin }), [isManager, isAdmin]);
  const byPath = useMemo(() => new Map(catalog.map((i) => [i.path, i])), [catalog]);
  const defaults = useMemo(
    () => (isManager ? defaultQuickActions.manager : defaultQuickActions.member).filter((p) => byPath.has(p)),
    [isManager, byPath]
  );

  const { quickActions, setQuickActions } = useUiPrefs();
  const selected = (quickActions || defaults).filter((p) => byPath.has(p));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(selected);

  const openEditor = () => { setDraft(selected); setEditing(true); };
  const commit = () => { setQuickActions(draft); setEditing(false); };

  const move = (i, dir) => setDraft((d) => {
    const n = [...d];
    const j = i + dir;
    if (j < 0 || j >= n.length) return n;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const remove = (p) => setDraft((d) => d.filter((x) => x !== p));
  const add = (p) => setDraft((d) => (d.includes(p) ? d : [...d, p]));

  const shown = selected.map((p) => byPath.get(p)).filter(Boolean);
  const available = catalog.filter((i) => !draft.includes(i.path));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Quick Actions</CardTitle>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7" onClick={openEditor}>
            <Settings2 className="w-3.5 h-3.5" /> Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {shown.length === 0 ? (
          <p className="col-span-2 text-sm text-muted-foreground text-center py-4">
            No quick actions yet — tap Edit to add some.
          </p>
        ) : shown.map((item) => (
          <Link key={item.path} to={item.path}>
            <Button variant="outline" className="w-full justify-start gap-2 h-12">
              <item.icon className="w-4 h-4" /> {item.label}
            </Button>
          </Link>
        ))}
      </CardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Customize Quick Actions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Shown ({draft.length})</p>
              {draft.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet — add some from below.</p>
              ) : (
                <div className="space-y-1.5">
                  {draft.map((p, i) => {
                    const it = byPath.get(p);
                    if (!it) return null;
                    return (
                      <div key={p} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
                        <it.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm flex-1 truncate">{it.label}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(p)} aria-label="Remove">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {available.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Add more</p>
                <div className="space-y-1.5">
                  {available.map((it) => (
                    <button
                      key={it.path}
                      type="button"
                      onClick={() => add(it.path)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 text-left transition-colors"
                    >
                      <it.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1 truncate">{it.label}</span>
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setDraft(defaults)}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={commit}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

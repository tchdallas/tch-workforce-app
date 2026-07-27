import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import {
  savePolicy, publishPolicy, uploadPolicyDocument, usePolicyDocuments, removePolicyDocument,
  usePolicyCategories, createPolicyCategory,
} from '@/lib/policies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { FileText, Paperclip, X, ScrollText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import MultiPicker from './MultiPicker';

const MAX_FILE_MB = 25;

export default function PolicyEditorDialog({ open, onClose, policy, onSaved }) {
  const qc = useQueryClient();
  const { scopeLocations } = useCurrentMember();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: existingDocs = [] } = usePolicyDocuments(policy?.id);

  const { data: categories = [] } = usePolicyCategories();
  const [title, setTitle] = useState('');
  const [categoryIds, setCategoryIds] = useState([]);
  const [newCategory, setNewCategory] = useState(null); // null = hidden; string = typing a new one
  const [addingCategory, setAddingCategory] = useState(false);
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [roleIds, setRoleIds] = useState([]);
  const [locationIds, setLocationIds] = useState([]);
  const [requiresAck, setRequiresAck] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const isEdit = !!policy?.id;

  useEffect(() => {
    if (!open) return;
    setTitle(policy?.title || '');
    setCategoryIds(policy?.categoryIds || []);
    setNewCategory(null);
    setSummary(policy?.summary || '');
    setBody(policy?.body || '');
    setRoleIds(policy?.roleIds || []);
    setLocationIds(policy?.locationIds || []);
    setRequiresAck(!!policy?.requires_acknowledgment);
    setPendingFiles([]);
  }, [open, policy]);

  const activeRoles = roles.filter(r => !r.status || r.status === 'active');
  // Only clubs this manager runs — the database enforces the same thing on the
  // policy_locations write, so offering more would just produce a failed save.
  const pickableLocations = scopeLocations(locations.filter(l => l.status === 'active'));

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    const tooBig = files.filter(f => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`${tooBig[0].name} is over ${MAX_FILE_MB}MB`);
    }
    setPendingFiles(prev => [...prev, ...files.filter(f => f.size <= MAX_FILE_MB * 1024 * 1024)]);
  };

  // Creates it immediately and selects it, so the new heading is available to
  // every other policy from this moment — not just this one.
  const addCategory = async () => {
    const name = (newCategory || '').trim();
    if (!name) return;
    setAddingCategory(true);
    try {
      const cat = await createPolicyCategory(name);
      await qc.invalidateQueries({ queryKey: ['policy-categories'] });
      // tick it on straight away — adding one you then have to go find is a step
      // nobody wants, and it's why you opened the field
      setCategoryIds(prev => (prev.includes(cat.id) ? prev : [...prev, cat.id]));
      setNewCategory(null);
    } catch (e) {
      toast.error(e.message?.includes('row-level security')
        ? 'Only managers and above can add a category.'
        : (e.message || 'Could not add that category'));
    } finally { setAddingCategory(false); }
  };

  const valid = title.trim() && roleIds.length > 0 && locationIds.length > 0;

  const persist = async (thenPublish) => {
    setSaving(true);
    try {
      const policyId = await savePolicy({
        id: policy?.id, title, categoryIds, summary, body,
        requiresAcknowledgment: requiresAck, roleIds, locationIds,
      });
      // documents need the policy id in their storage path, so they upload only
      // once the row exists — which is why a brand-new policy saves first
      for (const f of pendingFiles) {
        await uploadPolicyDocument(policyId, f);
      }
      if (thenPublish) await publishPolicy(policyId);

      qc.invalidateQueries({ queryKey: ['policies'] });
      qc.invalidateQueries({ queryKey: ['policy', policyId] });
      qc.invalidateQueries({ queryKey: ['policy-documents', policyId] });
      toast.success(thenPublish ? 'Policy published' : 'Draft saved');
      onSaved?.(policyId);
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const dropDoc = async (doc) => {
    try {
      await removePolicyDocument(doc);
      qc.invalidateQueries({ queryKey: ['policy-documents', policy.id] });
    } catch (e) { toast.error(e.message || 'Could not remove that file'); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4" /> {isEdit ? 'Edit policy' : 'New policy'}
          </DialogTitle>
          <DialogDescription>
            Who it applies to is set by role and club — people outside that audience never see it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Betting Out of Turn" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <MultiPicker
              options={categories.map(c => ({ id: c.id, name: c.name }))}
              value={categoryIds}
              onChange={setCategoryIds}
              placeholder="Uncategorised"
              emptyHint="No categories yet — add the first one below."
            />
            {newCategory === null ? (
              <button
                type="button"
                onClick={() => setNewCategory('')}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-3.5 h-3.5" /> New category
              </button>
            ) : (
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  autoFocus
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="e.g. Game Procedures"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                />
                <Button type="button" size="sm" disabled={!newCategory.trim() || addingCategory} onClick={addCategory}>
                  {addingCategory ? 'Adding…' : 'Add'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setNewCategory(null)}>Cancel</Button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              A policy can sit under several. It shows up under each one, and you can change them later.
            </p>
          </div>
          <div>
            <Label className="text-xs">Summary</Label>
            <Input value={summary} onChange={e => setSummary(e.target.value)} placeholder="One line shown in the list" />
          </div>
          <div>
            <Label className="text-xs">The policy / procedure</Label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Write the procedure out here. You can also (or instead) attach the document below."
            />
          </div>

          <div>
            <Label className="text-xs">Applies to these roles</Label>
            <MultiPicker
              options={activeRoles.map(r => ({ id: r.id, name: r.name }))}
              value={roleIds}
              onChange={setRoleIds}
              placeholder="Choose roles"
            />
          </div>
          <div>
            <Label className="text-xs">At these clubs</Label>
            <MultiPicker
              options={pickableLocations.map(l => ({ id: l.id, name: l.name }))}
              value={locationIds}
              onChange={setLocationIds}
              placeholder="Choose clubs"
              emptyHint="You don't manage any clubs yet."
            />
          </div>

          <div>
            <Label className="text-xs">Attached documents</Label>
            <div className="mt-1 space-y-1.5">
              {existingDocs.map(d => (
                <div key={d.id} className="flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5">
                  <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{d.file_name}</span>
                  <button type="button" onClick={() => dropDoc(d)} className="p-1 rounded hover:bg-muted" aria-label={`Remove ${d.file_name}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {pendingFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm rounded-md border border-dashed border-border px-2 py-1.5">
                  <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">pending</span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    className="p-1 rounded hover:bg-muted"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm rounded-md border border-dashed border-border px-2 py-2 cursor-pointer hover:bg-muted/50">
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Attach a file (PDF, image, doc — up to {MAX_FILE_MB}MB)</span>
                <input type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Require acknowledgment</p>
              <p className="text-[11px] text-muted-foreground">
                Everyone in the audience confirms they've read it, and you see who hasn't.
              </p>
            </div>
            <Switch checked={requiresAck} onCheckedChange={setRequiresAck} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="outline" disabled={!valid || saving} onClick={() => persist(false)}>
            Save draft
          </Button>
          <Button disabled={!valid || saving} onClick={() => persist(true)}>
            {saving ? 'Saving…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function friendlyError(e) {
  const m = e?.message || '';
  if (m.includes('at least one role')) return 'Choose at least one role this policy applies to.';
  if (m.includes('at least one club')) return 'Choose at least one club this policy applies at.';
  if (m.includes('do not manage')) return "You can only publish to clubs you manage.";
  if (m.includes('managers and above')) return 'Only managers and above can publish policies.';
  if (m.toLowerCase().includes('row-level security') || m.includes('policy')) {
    return "You don't have permission to save that.";
  }
  return m || 'Could not save the policy';
}

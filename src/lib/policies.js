import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';

// Policies talk to the DB directly, like announcements: recipient snapshots and
// the audience math live in publish_policy() / publish_policy_update(), and RLS
// (20260725000002_policies.sql) enforces every access rule server-side. Nothing
// here is a permission check — it's all shaping data for the screen.

const POLICY_COLS =
  'id, title, summary, body, status, requires_acknowledgment, published_at, created_at, updated_at, created_by';

// ------------------------------------------------------------------- reads

// The managed category list. Readable by everyone — a team member needs the
// name to see the heading their policy files under.
export function usePolicyCategories() {
  return useQuery({
    queryKey: ['policy-categories'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_categories')
        .select('id, name, display_order, status')
        .eq('status', 'active')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

// Returns the existing row when the name is already taken (case-insensitively),
// so two managers adding "Game Procedures" at once don't produce a duplicate or
// a confusing unique-violation error.
export async function createPolicyCategory(name) {
  const clean = name.trim();
  const { data, error } = await supabase
    .from('policy_categories')
    .insert({ name: clean })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('policy_categories')
        .select('id, name')
        .ilike('name', clean)
        .maybeSingle();
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

export async function renamePolicyCategory(id, name) {
  const { error } = await supabase
    .from('policy_categories')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) throw error;
}

// Archive rather than delete — policies pointing at it keep working, they just
// fall back to "Uncategorised" in the list.
export async function archivePolicyCategory(id) {
  const { error } = await supabase
    .from('policy_categories')
    .update({ status: 'archived' })
    .eq('id', id);
  if (error) throw error;
}

// Every policy I'm allowed to see. RLS already filters to my roles + clubs, so
// this is a plain select — the audience never has to be recomputed client-side.
export function usePolicies() {
  return useQuery({
    queryKey: ['policies'],
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policies')
        .select(`${POLICY_COLS}, policy_roles(role_id), policy_locations(location_id), policy_category_links(category_id)`)
        .order('title', { ascending: true });
      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        roleIds: (p.policy_roles || []).map(r => r.role_id),
        locationIds: (p.policy_locations || []).map(l => l.location_id),
        categoryIds: (p.policy_category_links || []).map(c => c.category_id),
      }));
    },
  });
}

export function usePolicy(policyId) {
  return useQuery({
    queryKey: ['policy', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policies')
        .select(`${POLICY_COLS}, policy_roles(role_id), policy_locations(location_id), policy_category_links(category_id)`)
        .eq('id', policyId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        roleIds: (data.policy_roles || []).map(r => r.role_id),
        locationIds: (data.policy_locations || []).map(l => l.location_id),
        categoryIds: (data.policy_category_links || []).map(c => c.category_id),
      };
    },
  });
}

export function usePolicyDocuments(policyId) {
  return useQuery({
    queryKey: ['policy-documents', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_documents')
        .select('id, policy_id, storage_path, file_name, content_type, file_size, uploaded_by, created_at')
        .eq('policy_id', policyId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

// Updates/addendums, newest first, with author names. Via a definer RPC because
// a dealer can't read the manager's team_members row to resolve created_by.
export function usePolicyUpdates(policyId) {
  return useQuery({
    queryKey: ['policy-updates', policyId],
    enabled: !!policyId,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('policy_updates_feed', { pid: policyId });
      if (error) throw error;
      return data || [];
    },
  });
}

// The discussion thread, also name-resolved server-side. Soft-deleted rows come
// back with a null body so the UI can leave a "removed" tombstone where a reply
// used to be, keeping the numbering of a long thread readable.
export function usePolicyComments(policyId) {
  return useQuery({
    queryKey: ['policy-comments', policyId],
    enabled: !!policyId,
    staleTime: 10000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('policy_thread', { pid: policyId });
      if (error) throw error;
      return data || [];
    },
  });
}

// My acknowledgment state for this policy and each of its updates. Two small
// selects rather than a join, because the recipient rows only exist when the
// author actually asked for acknowledgment.
export function useMyPolicyAcks(policyId, memberId) {
  return useQuery({
    queryKey: ['policy-my-acks', policyId, memberId],
    enabled: !!policyId && !!memberId,
    queryFn: async () => {
      const [pol, upd] = await Promise.all([
        supabase
          .from('policy_recipients')
          .select('policy_id, acknowledged_at')
          .eq('policy_id', policyId)
          .eq('team_member_id', memberId)
          .maybeSingle(),
        supabase
          .from('policy_update_recipients')
          .select('policy_update_id, acknowledged_at, policy_updates!inner(policy_id)')
          .eq('team_member_id', memberId)
          .eq('policy_updates.policy_id', policyId),
      ]);
      if (pol.error) throw pol.error;
      if (upd.error) throw upd.error;
      const updates = {};
      (upd.data || []).forEach(r => { updates[r.policy_update_id] = r.acknowledged_at; });
      return {
        // null row = not a recipient (acknowledgment wasn't required of me)
        policyRequired: !!pol.data,
        policyAcknowledgedAt: pol.data?.acknowledged_at || null,
        updates,
      };
    },
  });
}

// Everything across all policies that's still waiting on me — drives the badge
// and the dashboard's "Needs Your Attention" inbox.
export function useOutstandingPolicyAcks(memberId) {
  return useQuery({
    queryKey: ['policy-acks-outstanding', memberId],
    enabled: !!memberId,
    staleTime: 30000,
    queryFn: async () => {
      const [pol, upd] = await Promise.all([
        supabase
          .from('policy_recipients')
          .select('policy_id, policies!inner(id, title, status)')
          .eq('team_member_id', memberId)
          .is('acknowledged_at', null),
        supabase
          .from('policy_update_recipients')
          .select('policy_update_id, policy_updates!inner(id, title, kind, policy_id, published_at)')
          .eq('team_member_id', memberId)
          .is('acknowledged_at', null),
      ]);
      if (pol.error) throw pol.error;
      if (upd.error) throw upd.error;
      return {
        policies: (pol.data || [])
          .filter(r => r.policies?.status === 'published')
          .map(r => ({ policyId: r.policy_id, title: r.policies.title })),
        updates: (upd.data || [])
          .filter(r => r.policy_updates?.published_at)
          .map(r => ({
            updateId: r.policy_update_id,
            policyId: r.policy_updates.policy_id,
            title: r.policy_updates.title,
            kind: r.policy_updates.kind,
          })),
      };
    },
  });
}

// "X of N acknowledged" rosters (manager+, via definer RPCs).
export function usePolicyAckStatus(policyId) {
  return useQuery({
    queryKey: ['policy-ack', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('policy_ack_status', { pid: policyId });
      if (error) throw error;
      const rows = data || [];
      return { rows, total: rows.length, acknowledged: rows.filter(r => r.acknowledged_at).length };
    },
  });
}

export function usePolicyUpdateAckStatus(updateId) {
  return useQuery({
    queryKey: ['policy-update-ack', updateId],
    enabled: !!updateId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('policy_update_ack_status', { uid: updateId });
      if (error) throw error;
      const rows = data || [];
      return { rows, total: rows.length, acknowledged: rows.filter(r => r.acknowledged_at).length };
    },
  });
}

// ------------------------------------------------------------------ writes

// Replace-in-place for the three many-to-many sets hanging off a policy.
async function syncSet(table, policyId, column, ids) {
  await supabase.from(table).delete().eq('policy_id', policyId);
  if (ids?.length) {
    const { error } = await supabase
      .from(table)
      .insert(ids.map(v => ({ policy_id: policyId, [column]: v })));
    if (error) throw error;
  }
}

export async function savePolicy({ id, title, categoryIds, summary, body, requiresAcknowledgment, roleIds, locationIds }) {
  const fields = {
    title: title?.trim(),
    summary: summary?.trim() || null,
    body: body?.trim() || null,
    requires_acknowledgment: !!requiresAcknowledgment,
  };
  let policyId = id;
  if (policyId) {
    const { error } = await supabase.from('policies').update(fields).eq('id', policyId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('policies').insert(fields).select('id').single();
    if (error) throw error;
    policyId = data.id;
  }
  await syncSet('policy_roles', policyId, 'role_id', roleIds);
  await syncSet('policy_locations', policyId, 'location_id', locationIds);
  await syncSet('policy_category_links', policyId, 'category_id', categoryIds);
  return policyId;
}

// Publishes (or re-publishes) — snapshots recipients when acknowledgment is on.
export async function publishPolicy(policyId) {
  const { error } = await supabase.rpc('publish_policy', { pid: policyId });
  if (error) throw error;
}

export async function archivePolicy(policyId) {
  const { error } = await supabase.from('policies').update({ status: 'archived' }).eq('id', policyId);
  if (error) throw error;
}

export async function postPolicyUpdate({ policyId, kind, title, body, requiresAcknowledgment }) {
  const { data, error } = await supabase
    .from('policy_updates')
    .insert({
      policy_id: policyId,
      kind,
      title: title?.trim(),
      body: body?.trim(),
      requires_acknowledgment: !!requiresAcknowledgment,
    })
    .select('id')
    .single();
  if (error) throw error;
  const { error: pubErr } = await supabase.rpc('publish_policy_update', { uid: data.id });
  if (pubErr) throw pubErr;
  return data.id;
}

export async function postPolicyComment({ policyId, parentId, body }) {
  const { error } = await supabase
    .from('policy_comments')
    .insert({ policy_id: policyId, parent_id: parentId || null, body: body?.trim() });
  if (error) throw error;
}

export async function setCommentPinned(commentId, pinned) {
  const { error } = await supabase.from('policy_comments').update({ pinned }).eq('id', commentId);
  if (error) throw error;
}

// Soft delete — the row stays for the audit trail, the UI shows a tombstone.
export async function deletePolicyComment(commentId) {
  const { error } = await supabase
    .from('policy_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw error;
}

export async function acknowledgePolicy(policyId, memberId) {
  const { error } = await supabase
    .from('policy_recipients')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('policy_id', policyId)
    .eq('team_member_id', memberId);
  if (error) throw error;
}

export async function acknowledgePolicyUpdate(updateId, memberId) {
  const { error } = await supabase
    .from('policy_update_recipients')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('policy_update_id', updateId)
    .eq('team_member_id', memberId);
  if (error) throw error;
}

// ---------------------------------------------------------------- documents

// Path convention is <policy_id>/<name> — the storage RLS policy reads the
// first segment to decide who may download, so it must not change.
export async function uploadPolicyDocument(policyId, file) {
  const safe = file.name.replace(/[^\w.\-() ]+/g, '_');
  const path = `${policyId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from('policy-documents')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  const { error: rowErr } = await supabase.from('policy_documents').insert({
    policy_id: policyId,
    storage_path: path,
    file_name: file.name,
    content_type: file.type || null,
    file_size: file.size ?? null,
  });
  if (rowErr) throw rowErr;
}

export async function policyDocumentUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from('policy-documents')
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function removePolicyDocument(doc) {
  await supabase.storage.from('policy-documents').remove([doc.storage_path]);
  const { error } = await supabase.from('policy_documents').delete().eq('id', doc.id);
  if (error) throw error;
}

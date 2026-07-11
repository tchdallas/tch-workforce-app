// Supabase-backed drop-in replacement for the base44 SDK surface this app uses:
//   client.entities.<Entity>.list(sort?, limit?)
//   client.entities.<Entity>.filter(query, sort?, limit?, skip?)   (supports $in/$ne/$gte/$lte/$gt/$lt)
//   client.entities.<Entity>.create/update/delete/bulkCreate
//   client.auth.me/logout/redirectToLogin
//   client.integrations.Core.UploadFile({ file }) -> { file_url }
//
// Screens keep base44's camelCase field names; this layer maps them to the
// Postgres snake_case schema, converts base44's embedded ID arrays to junction
// tables, and routes team members' shift reads through the schedule_shifts view.
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// current member cache (drives Shift table-vs-view routing and auth.me)
// ---------------------------------------------------------------------------

const RANK = {
  team_member: 1,
  scheduler: 2,
  manager: 3,
  location_admin: 4,
  corporate_admin: 5,
  super_admin: 6,
};

let memberCache = null;
let memberPromise = null;

export async function getCurrentMemberRow(force = false) {
  if (force) { memberCache = null; memberPromise = null; }
  if (memberCache) return memberCache;
  if (!memberPromise) {
    memberPromise = (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      memberCache = data || null;
      return memberCache;
    })().finally(() => { memberPromise = null; });
  }
  return memberPromise;
}

supabase.auth.onAuthStateChange(() => { memberCache = null; });

// ---------------------------------------------------------------------------
// name mapping
// ---------------------------------------------------------------------------

const camelToSnake = (s) => s.replace(/([A-Z])/g, '_$1').toLowerCase();
const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// base44 stored datetimes as naive local strings ('2026-07-03T23:20:00') and
// the screens group/compare them as strings. Postgres returns UTC ISO with an
// offset. Convert on the way out (UTC -> local naive) and in (local naive ->
// UTC) so screens keep behaving exactly as they did.
const OFFSET_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)$/;
const NAIVE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

const pad = (n) => String(n).padStart(2, '0');

function tsFromDb(v) {
  if (typeof v !== 'string' || !OFFSET_TS.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tsToDb(v) {
  if (typeof v !== 'string' || !NAIVE_TS.test(v)) return v;
  const d = new Date(v); // naive strings parse as local time
  if (isNaN(d)) return v;
  return d.toISOString();
}

// columns available on the schedule_shifts view (team-member shift reads)
const VIEW_COLS = new Set([
  'id', 'location_id', 'role_id', 'team_member_id', 'start_at', 'end_at',
  'break_minutes', 'break_note', 'status', 'shift_type', 'team_facing_notes',
  'coverage_status', 'recent_change_flag', 'tags',
]);

const ENTITIES = {
  Location: { table: 'locations' },
  Role: {
    table: 'roles',
    junctions: [{ prop: 'assignedLocationIds', table: 'role_locations', fk: 'role_id', other: 'location_id' }],
  },
  TeamMember: {
    table: 'team_members',
    // user_id is the auth-account link, managed only by DB triggers; edit forms
    // echo back whole member objects, so writing it here would wipe the link
    readOnly: ['userId', 'user_id'],
    junctions: [
      { prop: 'assignedLocationIds', table: 'team_member_locations', fk: 'team_member_id', other: 'location_id' },
      { prop: 'assignedRoleIds', table: 'team_member_roles', fk: 'team_member_id', other: 'role_id' },
    ],
  },
  TeamMemberPayRate: { table: 'team_member_pay_rates' },
  Shift: {
    table: 'shifts',
    rename: { startDateTime: 'start_at', endDateTime: 'end_at' },
    memberView: 'schedule_shifts',
  },
  ScheduleTemplate: {
    table: 'schedule_templates',
    children: { prop: 'shifts', table: 'schedule_template_shifts', fk: 'template_id' },
  },
  Availability: { table: 'availability' },
  BlackoutDay: { table: 'blackout_days' },
  TimeOffRequest: {
    table: 'time_off_requests',
    rename: { startDateTime: 'start_at', endDateTime: 'end_at' },
  },
  ShiftTradeRequest: { table: 'shift_trade_requests' },
  ShiftGiveawayRequest: {
    table: 'shift_giveaway_requests',
    junctions: [{ prop: 'targetTeamMemberIds', table: 'shift_giveaway_targets', fk: 'giveaway_id', other: 'team_member_id' }],
  },
  OpenShiftClaim: { table: 'open_shift_claims' },
  Callout: { table: 'callouts' },
  TimeEntry: { table: 'time_entries' },
  LiveRoadmapNote: { table: 'live_roadmap_notes' },
  // par levels: named location-wide staffing-plan templates; each holds
  // target-headcount windows per role/gaming-day/time
  ParTemplate: { table: 'par_templates' },
  ParLevel: { table: 'par_levels' },
  // blindWrites: creators of these rows often can't SELECT them back under RLS
  // (a notification belongs to its recipient; audit reads are manager+), so
  // writes skip the RETURNING clause and reads of the result aren't attempted
  AuditLog: { table: 'audit_logs', blindWrites: true },
  Notification: { table: 'notifications', blindWrites: true },
  AppSetting: { table: 'app_settings', rename: { userId: 'team_member_id' } },
};

function colFor(cfg, key) {
  if (key === 'created_date' || key === 'createdDate') return 'created_at';
  if (key === 'updated_date' || key === 'updatedDate') return 'updated_at';
  if (cfg.rename && cfg.rename[key]) return cfg.rename[key];
  return camelToSnake(key);
}

function reverseRename(cfg) {
  if (!cfg._rev) {
    cfg._rev = {};
    for (const [camel, snake] of Object.entries(cfg.rename || {})) cfg._rev[snake] = camel;
  }
  return cfg._rev;
}

function selectFor(cfg) {
  let sel = '*';
  for (const j of cfg.junctions || []) sel += `,${j.table}(${j.other})`;
  if (cfg.children) sel += `,${cfg.children.table}(*)`;
  return sel;
}

// db row -> screen-facing camelCase object
function mapRowOut(cfg, row) {
  if (!row) return row;
  const rev = reverseRename(cfg);
  const junctionTables = new Set((cfg.junctions || []).map((j) => j.table));
  if (cfg.children) junctionTables.add(cfg.children.table);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (junctionTables.has(k)) continue;
    out[rev[k] || snakeToCamel(k)] = tsFromDb(v);
  }
  // base44 built-ins some screens sort/display by
  out.created_date = tsFromDb(row.created_at);
  out.updated_date = tsFromDb(row.updated_at);
  for (const j of cfg.junctions || []) {
    out[j.prop] = (row[j.table] || []).map((x) => x[j.other]);
  }
  if (cfg.children) {
    out[cfg.children.prop] = (row[cfg.children.table] || []).map((c) => {
      const child = {};
      for (const [k, v] of Object.entries(c)) child[snakeToCamel(k)] = v;
      if (typeof child.startTime === 'string') child.startTime = child.startTime.slice(0, 5);
      if (typeof child.endTime === 'string') child.endTime = child.endTime.slice(0, 5);
      return child;
    });
  }
  if (cfg.table === 'team_members') {
    out.noShiftSwap = !!(row.no_shift_swap_give || row.no_shift_swap_receive);
  }
  return out;
}

// screen-facing camelCase data -> db columns (junction/child props stripped)
function mapDataIn(cfg, data) {
  const skip = new Set([
    'id', 'created_date', 'updated_date', 'createdDate', 'updatedDate',
    'created_at', 'updated_at', 'created_by',
    ...(cfg.readOnly || []),
    ...(cfg.junctions || []).map((j) => j.prop),
    ...(cfg.children ? [cfg.children.prop] : []),
  ]);
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (skip.has(k) || v === undefined) continue;
    if (cfg.table === 'team_members' && k === 'noShiftSwap') {
      // legacy combined flag: only honored when the two real toggles are absent
      if (!('noShiftSwapGive' in data) && !('noShiftSwapReceive' in data)) {
        out.no_shift_swap_give = !!v;
        out.no_shift_swap_receive = !!v;
      }
      continue;
    }
    const col = colFor(cfg, k);
    // base44 tolerated '' for empty references; Postgres uuid columns do not
    out[col] = v === '' && col.endsWith('_id') ? null : tsToDb(v);
  }
  return out;
}

function mapChildIn(child) {
  const out = {};
  for (const [k, v] of Object.entries(child || {})) {
    if (v === undefined || k === 'id') continue;
    out[camelToSnake(k)] = v === '' ? null : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// query building
// ---------------------------------------------------------------------------

function applyCondition(q, col, val) {
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    for (const [op, raw] of Object.entries(val)) {
      const v = tsToDb(raw);
      switch (op) {
        case '$in': q = q.in(col, raw || []); break;
        case '$nin': q = q.not(col, 'in', `(${(raw || []).join(',')})`); break;
        case '$ne': q = v === null ? q.not(col, 'is', null) : q.neq(col, v); break;
        case '$gte': q = q.gte(col, v); break;
        case '$lte': q = q.lte(col, v); break;
        case '$gt': q = q.gt(col, v); break;
        case '$lt': q = q.lt(col, v); break;
        default: throw new Error(`Unsupported filter operator ${op} on ${col}`);
      }
    }
    return q;
  }
  return val === null ? q.is(col, null) : q.eq(col, tsToDb(val));
}

function throwIfError(error, context) {
  if (!error) return;
  const err = new Error(`${context}: ${error.message}`);
  err.status = error.code === '42501' ? 403 : 400;
  err.code = error.code;
  throw err;
}

async function resolveRead(cfg) {
  if (!cfg.memberView) return { table: cfg.table, viewMode: false };
  const member = await getCurrentMemberRow();
  const rank = member ? RANK[member.permission_level] || 1 : 1;
  return rank >= RANK.scheduler
    ? { table: cfg.table, viewMode: false }
    : { table: cfg.memberView, viewMode: true };
}

// Supabase caps any single response at 1,000 rows; with 1,000+ team members we
// page through in chunks until the requested amount (or everything) is fetched.
const PAGE = 1000;

async function runFilter(cfg, query, sort, limit, skip) {
  const { table, viewMode } = await resolveRead(cfg);
  const buildQuery = () => {
    let q = supabase.from(table).select(viewMode ? '*' : selectFor(cfg));
    for (const [key, val] of Object.entries(query || {})) {
      const col = colFor(cfg, key);
      if (viewMode && !VIEW_COLS.has(col)) continue; // view is pre-filtered (published, not archived)
      q = applyCondition(q, col, val);
    }
    const sortCol = sort ? colFor(cfg, sort.startsWith('-') ? sort.slice(1) : sort) : null;
    if (sortCol && (!viewMode || VIEW_COLS.has(sortCol))) {
      q = q.order(sortCol, { ascending: !sort.startsWith('-') });
    }
    // stable tiebreaker so pagination never skips/duplicates rows
    if (sortCol !== 'id') q = q.order('id', { ascending: true });
    return q;
  };

  const wanted = limit || Infinity;
  const rows = [];
  let from = skip || 0;
  for (;;) {
    const to = from + Math.min(PAGE, wanted - rows.length) - 1;
    const { data, error } = await buildQuery().range(from, to);
    throwIfError(error, `${cfg.table} filter`);
    rows.push(...(data || []));
    if (!data || data.length < to - from + 1 || rows.length >= wanted) break;
    from = to + 1;
  }
  return rows.map((r) => mapRowOut(cfg, r));
}

async function fetchById(cfg, id) {
  const { data, error } = await supabase
    .from(cfg.table)
    .select(selectFor(cfg))
    .eq('id', id)
    .maybeSingle();
  throwIfError(error, `${cfg.table} fetch`);
  return mapRowOut(cfg, data);
}

async function syncJunctions(cfg, id, data) {
  for (const j of cfg.junctions || []) {
    const ids = data[j.prop];
    if (!Array.isArray(ids)) continue; // untouched
    const del = await supabase.from(j.table).delete().eq(j.fk, id);
    throwIfError(del.error, `${j.table} sync`);
    if (ids.length) {
      const ins = await supabase
        .from(j.table)
        .insert(ids.map((v) => ({ [j.fk]: id, [j.other]: v })));
      throwIfError(ins.error, `${j.table} sync`);
    }
  }
  if (cfg.children && Array.isArray(data[cfg.children.prop])) {
    const { table, fk, prop } = cfg.children;
    const del = await supabase.from(table).delete().eq(fk, id);
    throwIfError(del.error, `${table} sync`);
    const rows = data[prop].map((c) => ({ ...mapChildIn(c), [fk]: id }));
    if (rows.length) {
      const ins = await supabase.from(table).insert(rows);
      throwIfError(ins.error, `${table} sync`);
    }
  }
}

function makeEntity(name, cfg) {
  return {
    list: (sort, limit) => runFilter(cfg, {}, sort, limit),
    filter: (query, sort, limit, skip) => runFilter(cfg, query, sort, limit, skip),

    get: (id) => fetchById(cfg, id),

    create: async (data) => {
      if (cfg.blindWrites) {
        const { error } = await supabase.from(cfg.table).insert(mapDataIn(cfg, data));
        throwIfError(error, `${name} create`);
        return { ...data };
      }
      const { data: row, error } = await supabase
        .from(cfg.table)
        .insert(mapDataIn(cfg, data))
        .select('id')
        .single();
      throwIfError(error, `${name} create`);
      await syncJunctions(cfg, row.id, data);
      return fetchById(cfg, row.id);
    },

    update: async (id, data) => {
      const mapped = mapDataIn(cfg, data);
      if (Object.keys(mapped).length) {
        const { error } = await supabase.from(cfg.table).update(mapped).eq('id', id);
        throwIfError(error, `${name} update`);
      }
      if (cfg.blindWrites) return { id, ...data };
      await syncJunctions(cfg, id, data);
      return fetchById(cfg, id);
    },

    // one UPDATE per 200 rows instead of one per row — bulk archive/restore at scale
    updateMany: async (ids, data) => {
      if (!ids?.length) return { count: 0 };
      const mapped = mapDataIn(cfg, data);
      let count = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { data: rows, error } = await supabase
          .from(cfg.table)
          .update(mapped)
          .in('id', ids.slice(i, i + 200))
          .select('id');
        throwIfError(error, `${name} updateMany`);
        count += rows?.length || 0;
      }
      return { count };
    },

    delete: async (id) => {
      // RETURNING tells us whether a row was actually removed — RLS-protected
      // rows (e.g. published shifts) otherwise "succeed" with zero rows and
      // undo/tracking logic would record a deletion that never happened
      const { data, error } = await supabase.from(cfg.table).delete().eq('id', id).select('id');
      throwIfError(error, `${name} delete`);
      if (!data || data.length === 0) {
        const err = new Error(`${name} delete: row not deleted (protected or already gone)`);
        err.status = 403;
        throw err;
      }
      return { id };
    },

    bulkCreate: async (items) => {
      if (!items?.length) return [];
      const { data, error } = await supabase
        .from(cfg.table)
        .insert(items.map((d) => mapDataIn(cfg, d)))
        .select('id');
      throwIfError(error, `${name} bulkCreate`);
      // batch the junction rows for the whole set (RETURNING preserves input order)
      for (const j of cfg.junctions || []) {
        const rows = [];
        data.forEach((r, idx) => {
          const ids = items[idx][j.prop];
          if (Array.isArray(ids)) ids.forEach((v) => rows.push({ [j.fk]: r.id, [j.other]: v }));
        });
        if (rows.length) {
          const ins = await supabase.from(j.table).insert(rows);
          throwIfError(ins.error, `${j.table} bulkCreate`);
        }
      }
      return items.map((d, i) => ({ ...d, id: data[i].id }));
    },
  };
}

const entities = {};
for (const [name, cfg] of Object.entries(ENTITIES)) entities[name] = makeEntity(name, cfg);

// ---------------------------------------------------------------------------
// auth + integrations
// ---------------------------------------------------------------------------

const auth = {
  me: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    const member = await getCurrentMemberRow();
    return {
      id: user.id,
      email: user.email,
      full_name: member
        ? `${member.preferred_name || member.first_name} ${member.last_name}`
        : user.email,
      role: member && ['super_admin', 'corporate_admin'].includes(member.permission_level)
        ? 'admin'
        : 'user',
      teamMemberId: member?.id || null,
      permissionLevel: member?.permission_level || null,
    };
  },
  logout: async () => {
    await supabase.auth.signOut();
  },
  redirectToLogin: () => {
    // login is rendered in-app by AuthContext/App when there is no session
  },
};

const integrations = {
  Core: {
    UploadFile: async ({ file }) => {
      const safeName = (file?.name || 'file').replace(/[^\w.\-]+/g, '_');
      const path = `${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, file);
      throwIfError(error && { message: error.message, code: error.statusCode }, 'UploadFile');
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      return { file_url: data.publicUrl };
    },
  },
};

// Email invites need a server-side function (service role) plus an email
// provider — planned alongside the Phase 4 notification service. Until then
// this explains itself instead of failing cryptically.
const users = {
  inviteUser: async () => {
    const err = new Error(
      'Email invites are coming with the notification service. For now, add the member here, then have them use "Forgot password?" on the login screen with their email.'
    );
    err.status = 501;
    throw err;
  },
};

export const dataClient = { entities, auth, integrations, users };

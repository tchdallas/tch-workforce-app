/**
 * Role-location access helpers.
 * A role with no assignedLocationIds is available at every location.
 * A role with assignedLocationIds is available only at those locations.
 */

export function isRoleAvailableAtLocation(role, locationId) {
  if (!role) return false;
  if (!role.assignedLocationIds || role.assignedLocationIds.length === 0) return true;
  if (!locationId) return false;
  return role.assignedLocationIds.includes(locationId);
}

/**
 * Roles available at a specific location (for scheduling views scoped to one location).
 * Always includes roles referenced by `keepRoleIds` so existing shifts still render.
 */
export function rolesAvailableAtLocation(roles, locationId, keepRoleIds = []) {
  const keep = new Set(keepRoleIds);
  return roles.filter(r => keep.has(r.id) || isRoleAvailableAtLocation(r, locationId));
}

/**
 * Roles visible to a user whose location access is `assignedLocationIds`.
 * - If the user is unrestricted (empty array), all roles are visible.
 * - Otherwise: role is visible if it's available everywhere OR intersects the user's locations.
 */
export function filterRolesByLocationAccess(roles, assignedLocationIds = []) {
  if (!assignedLocationIds || assignedLocationIds.length === 0) return roles;
  const allowed = new Set(assignedLocationIds);
  return roles.filter(r =>
    !r.assignedLocationIds || r.assignedLocationIds.length === 0 ||
    r.assignedLocationIds.some(id => allowed.has(id))
  );
}
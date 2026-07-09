import { useState, useEffect } from 'react';
import { useCurrentMember } from './useCurrentMember';

/**
 * Centralized location filter for admin/reporting views.
 * - Restricts selectable locations to the user's assigned locations (when any are assigned).
 * - If the user has exactly one assigned location, defaults to (and locks) that location.
 * - Returns a server-side query fragment to merge into entity filters.
 */
export function useLocationFilter() {
  const { assignedLocationIds } = useCurrentMember();
  const restricted = assignedLocationIds.length > 0;
  const allowedIds = restricted ? assignedLocationIds : undefined;
  const single = assignedLocationIds.length === 1 ? assignedLocationIds[0] : null;

  const [selectedLocation, setSelectedLocation] = useState(() => single || 'all');

  useEffect(() => {
    if (single) setSelectedLocation(single);
  }, [single]);

  const isAll = selectedLocation === 'all';
  const locationId = isAll ? null : selectedLocation;
  const isLocked = !!single;

  // Merge into entity filter queries (entities with a locationId field)
  const locationQuery = restricted && isAll
    ? { locationId: { $in: assignedLocationIds } }
    : locationId ? { locationId } : {};

  return {
    selectedLocation,
    setSelectedLocation,
    allowedIds,
    isLocked,
    isAll,
    locationId,
    locationQuery,
    restricted,
  };
}
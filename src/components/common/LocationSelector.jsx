import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocations } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';

export default function LocationSelector({ value, onChange, showAll = true, className, allowedIds }) {
  const { data: locations } = useLocations();
  const { scopeLocations } = useCurrentMember();
  // Scope to the current user's locations (location_admins etc. only see theirs;
  // company-wide admins see all), then honor any explicit allowedIds override.
  const activeLocations = scopeLocations(locations.filter(l => l.status === 'active'))
    .filter(l => !allowedIds?.length || allowedIds.includes(l.id));

  return (
    <Select value={value || 'all'} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select location" />
      </SelectTrigger>
      <SelectContent>
        {showAll && <SelectItem value="all">All Locations</SelectItem>}
        {activeLocations.map(loc => (
          <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
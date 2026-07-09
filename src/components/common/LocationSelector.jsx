import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocations } from '@/lib/useAppData';

export default function LocationSelector({ value, onChange, showAll = true, className, allowedIds }) {
  const { data: locations } = useLocations();
  const activeLocations = locations.filter(l =>
    l.status === 'active' && (!allowedIds?.length || allowedIds.includes(l.id))
  );

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
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const typeColors = {
  available: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unavailable: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  preferred: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function AvailabilityForm({ memberId }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(null);

  const { data: availabilities = [] } = useQuery({
    queryKey: ['my-availability', memberId],
    queryFn: () => base44.entities.Availability.filter({ teamMemberId: memberId }),
    enabled: !!memberId,
    placeholderData: [],
  });

  const getDay = (dow) => availabilities.find(a => a.dayOfWeek === dow);

  const saveMutation = useMutation({
    mutationFn: async ({ dow, availabilityType, startTime, endTime }) => {
      const existing = getDay(dow);
      const data = { teamMemberId: memberId, dayOfWeek: dow, availabilityType, startTime, endTime };
      if (existing) return base44.entities.Availability.update(existing.id, data);
      return base44.entities.Availability.create(data);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['my-availability', memberId] });
      setSaving(null);
      toast.success('Availability saved');
    },
  });

  const DayRow = ({ dow }) => {
    const existing = getDay(dow);
    const [type, setType] = useState(existing?.availabilityType || 'available');
    const [startTime, setStartTime] = useState(existing?.startTime || '09:00');
    const [endTime, setEndTime] = useState(existing?.endTime || '17:00');

    const isSaving = saving === dow;

    const handleSave = () => {
      setSaving(dow);
      saveMutation.mutate({ dow, availabilityType: type, startTime, endTime });
    };

    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3 border-b border-border last:border-0">
        <span className="text-sm font-medium w-24 shrink-0">{DAYS[dow]}</span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
              <SelectItem value="preferred">Preferred</SelectItem>
            </SelectContent>
          </Select>
          {type !== 'unavailable' && (
            <>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-28 h-8 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-28 h-8 text-xs" />
            </>
          )}
          <Button size="sm" className="h-8 px-3 ml-auto" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-3">Set your weekly availability. Managers can see this when scheduling.</p>
        {DAYS.map((_, dow) => (
          <DayRow key={dow} dow={dow} />
        ))}
      </CardContent>
    </Card>
  );
}
import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AvailabilityForm({ memberId, manager = false }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const timers = useRef({});
  const savedTimer = useRef(null);

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
      // "unavailable" means the whole day — no time window
      const data = {
        teamMemberId: memberId, dayOfWeek: dow, availabilityType,
        startTime: availabilityType === 'unavailable' ? null : startTime,
        endTime: availabilityType === 'unavailable' ? null : endTime,
      };
      if (existing) return base44.entities.Availability.update(existing.id, data);
      return base44.entities.Availability.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-availability', memberId] });
      setStatus('saved');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus('idle'), 1800);
    },
    onError: () => { setStatus('idle'); toast.error('Could not save availability'); },
  });

  // auto-save each day, debounced so rapid time edits coalesce into one write
  const scheduleSave = (dow, payload) => {
    setStatus('saving');
    clearTimeout(timers.current[dow]);
    timers.current[dow] = setTimeout(() => saveMutation.mutate({ dow, ...payload }), 600);
  };

  const DayRow = ({ dow }) => {
    const existing = getDay(dow);
    const [type, setType] = useState(existing?.availabilityType || 'available');
    const [startTime, setStartTime] = useState(existing?.startTime?.slice(0, 5) || '09:00');
    const [endTime, setEndTime] = useState(existing?.endTime?.slice(0, 5) || '17:00');

    const push = (next) => scheduleSave(dow, { availabilityType: type, startTime, endTime, ...next });

    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3 border-b border-border last:border-0">
        <span className="text-sm font-medium w-24 shrink-0">{DAYS[dow]}</span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <Select value={type} onValueChange={v => { setType(v); push({ availabilityType: v }); }}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable (all day)</SelectItem>
              <SelectItem value="preferred">Preferred</SelectItem>
            </SelectContent>
          </Select>
          {type !== 'unavailable' && (
            <>
              <Input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); push({ startTime: e.target.value }); }} className="w-28 h-8 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); push({ endTime: e.target.value }); }} className="w-28 h-8 text-xs" />
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <p className="text-xs text-muted-foreground">
            {manager ? "This team member's weekly availability." : 'Your weekly availability. Managers see this when scheduling.'}{' '}
            Changes save automatically.
          </p>
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0 min-w-[64px] justify-end">
            {status === 'saving' && <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>}
            {status === 'saved' && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>}
          </span>
        </div>
        {DAYS.map((_, dow) => {
          const e = getDay(dow);
          return <DayRow key={`${dow}-${e?.id || 'new'}-${e?.availabilityType || ''}-${e?.startTime || ''}-${e?.endTime || ''}`} dow={dow} />;
        })}
      </CardContent>
    </Card>
  );
}

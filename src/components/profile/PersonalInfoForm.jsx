import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function PersonalInfoForm({ member, onSave, saving }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    setForm({
      preferredName: member.preferredName || '',
      phone: member.phone || '',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zip: member.zip || '',
      emergencyContactName: member.emergencyContactName || '',
      emergencyContactPhone: member.emergencyContactPhone || '',
    });
  }, [member]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Read-only name/email */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">First Name</Label>
            <Input value={member.firstName} disabled className="bg-muted/40" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Last Name</Label>
            <Input value={member.lastName} disabled className="bg-muted/40" />
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Email</Label>
          <Input value={member.email} disabled className="bg-muted/40" />
        </div>

        <div>
          <Label className="text-xs">Preferred Name / Nickname</Label>
          <Input value={form.preferredName} onChange={e => set('preferredName', e.target.value)} placeholder="What should we call you?" />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" />
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Address</p>
          <div className="space-y-2">
            <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address" />
            <div className="grid grid-cols-3 gap-2">
              <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" className="col-span-1" />
              <Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="State" />
              <Input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="Zip" />
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Emergency Contact</p>
          <div className="space-y-2">
            <Input value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} placeholder="Contact name" />
            <Input value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} placeholder="Contact phone" />
          </div>
        </div>

        <Button className="w-full" onClick={() => onSave(form)} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : 'Save Changes'}
        </Button>
      </CardContent>
    </Card>
  );
}
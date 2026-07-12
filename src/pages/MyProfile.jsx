import React, { useState, useRef } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import ProfilePhotoSection from '@/components/profile/ProfilePhotoSection';
import PersonalInfoForm from '@/components/profile/PersonalInfoForm';
import TimeOffForm from '@/components/profile/TimeOffForm';
import AvailabilityForm from '@/components/profile/AvailabilityForm';
import ChangePasswordCard from '@/components/profile/ChangePasswordCard';
import MemberDownsView from '@/components/downs/MemberDownsView';
import { toast } from 'sonner';
import { User, CalendarOff, Clock, LogOut, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

export default function MyProfile() {
  const queryClient = useQueryClient();
  const { member } = useCurrentMember();
  const { logout } = useAuth();

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.update(member.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['current-member'] });
      toast.success('Profile updated');
    },
  });

  if (!member) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-sm text-muted-foreground">No team member profile linked to your account.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="My Profile" subtitle="Manage your personal information and requests" />

      <ProfilePhotoSection member={member} onSave={(data) => updateMutation.mutate(data)} />

      <Tabs defaultValue="info" className="mt-6">
        <TabsList className="w-full">
          <TabsTrigger value="info" className="flex-1 gap-1.5 text-xs">
            <User className="w-3.5 h-3.5" /> Personal Info
          </TabsTrigger>
          <TabsTrigger value="timeoff" className="flex-1 gap-1.5 text-xs">
            <CalendarOff className="w-3.5 h-3.5" /> Time Off
          </TabsTrigger>
          <TabsTrigger value="availability" className="flex-1 gap-1.5 text-xs">
            <Clock className="w-3.5 h-3.5" /> Availability
          </TabsTrigger>
          <TabsTrigger value="downs" className="flex-1 gap-1.5 text-xs">
            <Trophy className="w-3.5 h-3.5" /> Downs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <PersonalInfoForm member={member} onSave={(data) => updateMutation.mutate(data)} saving={updateMutation.isPending} />
          <ChangePasswordCard />
        </TabsContent>

        <TabsContent value="timeoff" className="mt-4">
          <TimeOffForm memberId={member.id} />
        </TabsContent>

        <TabsContent value="availability" className="mt-4">
          <AvailabilityForm memberId={member.id} />
        </TabsContent>

        <TabsContent value="downs" className="mt-4">
          <MemberDownsView memberId={member.id} />
        </TabsContent>
      </Tabs>

      <div className="mt-8 pb-6">
        <Button variant="outline" className="w-full gap-2 text-destructive hover:text-destructive" onClick={logout}>
          <LogOut className="w-4 h-4" /> Sign Out
        </Button>
      </div>
    </div>
  );
}
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
// Add page imports here
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Schedule from '@/pages/Schedule';
import LiveRoadmap from '@/pages/LiveRoadmap';
import TeamMembers from '@/pages/TeamMembers';
import Locations from '@/pages/Locations';
import Roles from '@/pages/Roles';
import Requests from '@/pages/Requests';
import Callouts from '@/pages/Callouts';
import OpenShifts from '@/pages/OpenShifts';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import Notifications from '@/pages/Notifications';
import AuditLog from '@/pages/AuditLog';
import MySchedule from '@/pages/MySchedule';
import MyProfile from '@/pages/MyProfile';
import ScheduleTemplates from '@/pages/ScheduleTemplates';
import Login from '@/pages/Login';
import Kiosk from '@/pages/Kiosk';
import Timesheets from '@/pages/Timesheets';
import ParLevels from '@/pages/ParLevels';
import Attendance from '@/pages/Attendance';
import Messages from '@/pages/Messages';
import Announcements from '@/pages/Announcements';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated, authError } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }
  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/roadmap" element={<LiveRoadmap />} />
        <Route path="/team-members" element={<TeamMembers />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/par-levels" element={<ParLevels />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/callouts" element={<Callouts />} />
        <Route path="/open-shifts" element={<OpenShifts />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/my-schedule" element={<MySchedule />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/my-profile" element={<MyProfile />} />
        <Route path="/schedule-templates" element={<ScheduleTemplates />} />
        <Route path="/timesheets" element={<Timesheets />} />
        <Route path="/attendance" element={<Attendance />} />
      </Route>
      {/* fullscreen kiosk — no app chrome */}
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
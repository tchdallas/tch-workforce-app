import React from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

const UserNotRegisteredError = () => {
  const { authError, logout } = useAuth();
  const email = authError?.email;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-slate-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-orange-100">
            <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Access Restricted</h1>
          <p className="text-slate-600 mb-6">
            You are not registered to use this application. Please contact the app administrator to request access.
          </p>

          {email && (
            <p className="text-sm text-slate-500 mb-6">
              You're signed in as <span className="font-medium text-slate-700">{email}</span>.
              If that's not the right account, sign out and try again.
            </p>
          )}

          <Button onClick={logout} className="w-full gap-2 mb-6">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>

          <div className="p-4 bg-slate-50 rounded-md text-sm text-slate-600 text-left">
            <p>If you believe this is an error, you can:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Verify you signed in with the email your manager has on file</li>
              <li>Sign out and sign back in with the correct account</li>
              <li>Contact the app administrator for access</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;

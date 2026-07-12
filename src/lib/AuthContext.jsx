import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabase';
import { getCurrentMemberRow } from '@/api/dataClient';
import { APP_URL } from '@/lib/appConfig';

const AuthContext = createContext();

// Kept for compatibility with components that read app-level settings; the
// app no longer has a hosted "public settings" concept.
const APP_PUBLIC_SETTINGS = { id: 'tch-workforce', public_settings: { name: 'TCH Workforce' } };

const ADMIN_LEVELS = new Set(['super_admin', 'corporate_admin']);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const applySession = useCallback(async (session) => {
    if (!session?.user) {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError({ type: 'auth_required', message: 'Authentication required' });
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return;
    }
    try {
      const member = await getCurrentMemberRow(true);

      if (!member) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: 'user_not_registered',
          message: 'No team member record is linked to this login. Contact your administrator.',
          email: session.user.email,
        });
      } else if (member.status === 'inactive' || member.status === 'archived') {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: 'user_not_registered',
          message: 'Your access to this app has been revoked.',
          email: session.user.email,
        });
      } else {
        setUser({
          id: session.user.id,
          email: session.user.email,
          full_name: `${member.preferred_name || member.first_name} ${member.last_name}`,
          role: ADMIN_LEVELS.has(member.permission_level) ? 'admin' : 'user',
          teamMemberId: member.id,
          permissionLevel: member.permission_level,
        });
        setIsAuthenticated(true);
        setAuthError(null);
        // mark them as truly "joined" the first time they actually open the app
        // (the invite auto-links user_id before they ever log in, so this is the
        // reliable signal). One-time write per member.
        if (!member.last_login_at) {
          supabase.from('team_members')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', member.id)
            .then(() => {});
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
      setIsAuthenticated(false);
      setAuthError({ type: 'unknown', message: error.message || 'Failed to verify your account' });
    }
    setIsLoadingAuth(false);
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) applySession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        applySession(session);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  // First-time account setup: creates the login; the database links it to the
  // matching team_members row by email. Unknown emails end up with no linked
  // member and see "Access Restricted" — so this is safe to expose.
  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  };

  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: APP_URL,
    });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setAuthError({ type: 'auth_required', message: 'Authentication required' });
  };

  const checkUserAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await applySession(session);
  }, [applySession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings: false,
        authError,
        appPublicSettings: APP_PUBLIC_SETTINGS,
        authChecked,
        signIn,
        signUp,
        resetPassword,
        logout,
        navigateToLogin: () => {}, // login renders in-app when there is no session
        checkUserAuth,
        checkAppState: checkUserAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

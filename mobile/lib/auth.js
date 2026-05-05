import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// Same email map as the web app
const USER_EMAIL_MAP = {
  'admin':  'admin@jinillabel.com',
  'admin1': 'admin1@jinillabel.com',
};
const ROLE_MAP = {
  'admin@jinillabel.com':  'admin',
  'admin1@jinillabel.com': 'staff',
};

const AuthContext = createContext(null);

const syncRealtimeAuth = (session) => {
  if (session?.access_token && supabase.realtime?.setAuth) {
    supabase.realtime.setAuth(session.access_token);
  }
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refreshSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();

    // Load existing session (persisted via AsyncStorage)
    supabase.auth.getSession().then(({ data: { session } }) => {
      syncRealtimeAuth(session);
      setSession(session);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncRealtimeAuth(session);
      setSession(session);
    });

    return () => {
      refreshSub.remove();
      subscription.unsubscribe();
    };
  }, []);

  const email    = session?.user?.email || null;
  const role     = ROLE_MAP[email] || 'staff';
  const isAdmin  = role === 'admin';
  const username = email
    ? (Object.entries(USER_EMAIL_MAP).find(([, v]) => v === email)?.[0] || email.split('@')[0])
    : null;

  const signIn = async (id, password) => {
    const emailAddr = USER_EMAIL_MAP[id.trim()] || id.trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailAddr,
      password,
    });
    if (data?.session) {
      syncRealtimeAuth(data.session);
      setSession(data.session);
    }
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, isAdmin, username, role, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

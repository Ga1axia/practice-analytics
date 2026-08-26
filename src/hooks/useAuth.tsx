import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { oauthRedirectTo } from '../lib/oauthRedirect';
import { isAdminRole } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/authTypes';

const IMPERSONATE_KEY = 'pa_impersonate_profile_id';

type AuthState = {
  session: Session | null;
  /** Real signed-in profile (never the impersonation target). */
  realProfile: Profile | null;
  /** Effective profile for routing / UI (impersonation target when active). */
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  impersonating: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => Promise<void>;
  startImpersonation: (profileId: string) => Promise<void>;
  stopImpersonation: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('pa_profiles')
    .select('id,email,role,display_name,employee_name,client_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [realProfile, setRealProfile] = useState<Profile | null>(null);
  const [impersonated, setImpersonated] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearImpersonation = useCallback(() => {
    setImpersonated(null);
    try {
      sessionStorage.removeItem(IMPERSONATE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const restoreImpersonation = useCallback(async (admin: Profile) => {
    if (!isAdminRole(admin.role)) {
      clearImpersonation();
      return;
    }
    let targetId: string | null = null;
    try {
      targetId = sessionStorage.getItem(IMPERSONATE_KEY);
    } catch {
      targetId = null;
    }
    if (!targetId || targetId === admin.id) {
      setImpersonated(null);
      return;
    }
    try {
      const target = await fetchProfile(targetId);
      if (!target) {
        clearImpersonation();
        return;
      }
      setImpersonated(target);
    } catch {
      clearImpersonation();
    }
  }, [clearImpersonation]);

  const load = useCallback(
    async (next: Session | null) => {
      setSession(next);
      if (!next?.user) {
        setRealProfile(null);
        setImpersonated(null);
        setLoading(false);
        return;
      }
      try {
        const p = await fetchProfile(next.user.id);
        setRealProfile(p);
        setError(p ? null : 'No profile linked to this account.');
        if (p) await restoreImpersonation(p);
        else clearImpersonation();
      } catch (e) {
        setRealProfile(null);
        clearImpersonation();
        setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    },
    [clearImpersonation, restoreImpersonation],
  );

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) void load(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void load(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    clearImpersonation();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setLoading(false);
      setError(err.message);
      throw err;
    }
  }, [clearImpersonation]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'email openid profile',
        redirectTo: oauthRedirectTo(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const signInWithMicrosoft = useCallback(async () => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email openid profile',
        redirectTo: oauthRedirectTo(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    clearImpersonation();
    await supabase.auth.signOut();
    setRealProfile(null);
    setSession(null);
  }, [clearImpersonation]);

  const startImpersonation = useCallback(
    async (profileId: string) => {
      if (!realProfile || !isAdminRole(realProfile.role)) {
        throw new Error('Only dashboard admins can use testing mode.');
      }
      if (profileId === realProfile.id) {
        clearImpersonation();
        return;
      }
      const target = await fetchProfile(profileId);
      if (!target) throw new Error('Profile not found.');
      try {
        sessionStorage.setItem(IMPERSONATE_KEY, profileId);
      } catch {
        /* ignore */
      }
      setImpersonated(target);
    },
    [clearImpersonation, realProfile],
  );

  const stopImpersonation = useCallback(() => {
    clearImpersonation();
  }, [clearImpersonation]);

  const profile = impersonated ?? realProfile;
  const impersonating = Boolean(impersonated && realProfile && impersonated.id !== realProfile.id);

  const value = useMemo(
    () => ({
      session,
      realProfile,
      profile,
      loading,
      error,
      impersonating,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      signOut,
      startImpersonation,
      stopImpersonation,
    }),
    [
      session,
      realProfile,
      profile,
      loading,
      error,
      impersonating,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      signOut,
      startImpersonation,
      stopImpersonation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

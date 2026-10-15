/**
 * Authentication state for the whole app.
 *
 * Supabase holds the accounts and issues a signed token (a JWT) once someone
 * logs in. The browser keeps that token; every request to our own backend
 * sends it along, and the backend verifies the signature to learn who is
 * asking. We never see or store a password.
 *
 * Everything auth-related in the app goes through this file, so swapping the
 * provider later means changing one module rather than hunting through
 * components.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The app must keep working with auth switched off, so a missing config is a
// disabled feature rather than a crash. This matters while you are setting up.
export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = authConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  // "loading" starts true so the UI can avoid flashing a signed-out header for
  // a moment before the stored session is read back.
  const [loading, setLoading] = useState(authConfigured);

  useEffect(() => {
    if (!authConfigured) return undefined;

    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session ?? null))
      .finally(() => setLoading(false));

    // Fires on sign-in, sign-out, token refresh, and on returning from an
    // OAuth redirect, so the header updates without a page reload.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signUpWithEmail = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    // With email confirmation on, no session comes back until they click the
    // link. The caller needs to know which happened to show the right message.
    return { needsConfirmation: !data.session };
  }, []);

  const signInWithEmail = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signInWithProvider = useCallback(async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider, // 'google' | 'apple'
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    // No return value: the browser navigates away to the provider.
  }, []);

  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  /** The bearer token to send to our own backend, or null when signed out. */
  const getAccessToken = useCallback(async () => {
    if (!authConfigured) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    authConfigured,
    signUpWithEmail,
    signInWithEmail,
    signInWithProvider,
    sendPasswordReset,
    signOut,
    getAccessToken,
  }), [session, loading, signUpWithEmail, signInWithEmail, signInWithProvider,
       sendPasswordReset, signOut, getAccessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * fetch with the signed-in user's token attached when there is one.
 * Anonymous use still works; the backend simply does not link the plan to an
 * account. Use this everywhere instead of bare fetch.
 */
export function useApiFetch() {
  const { getAccessToken } = useAuth();
  return useCallback(async (url, options = {}) => {
    const token = await getAccessToken();
    const headers = { ...(options.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }, [getAccessToken]);
}

/** Human-readable messages. Supabase's raw errors are too terse to show. */
export function describeAuthError(error) {
  const message = (error?.message ?? '').toLowerCase();
  if (message.includes('invalid login')) {
    return 'That email and password do not match an account.';
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (message.includes('password should be')) {
    return 'Your password needs to be at least 6 characters.';
  }
  if (message.includes('email not confirmed')) {
    return 'Check your inbox and confirm your email address first.';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (message.includes('provider is not enabled')) {
    return 'That sign-in method is not switched on yet.';
  }
  return error?.message || 'Something went wrong. Please try again.';
}
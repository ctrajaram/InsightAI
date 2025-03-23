'use client';

import { useState, useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { type SupabaseClient, type Session } from '@supabase/supabase-js';

export type SupabaseHook = {
  supabase: SupabaseClient;
  user: any;
  loading: boolean;
  session: Session | null;
  getAccessToken: () => Promise<string | null>;
  isAuthenticated: boolean;
}

export const useSupabase = (): SupabaseHook => {
  const [supabase] = useState<SupabaseClient>(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Function to get the current access token
  const getAccessToken = async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || null;
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  };

  useEffect(() => {
    async function getUser() {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
        setUser(data.session?.user || null);
        setIsAuthenticated(!!data.session);
      } catch (error) {
        console.error('Error getting user:', error);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }

    // Initial user fetch
    getUser();

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null);
        setSession(session);
        setIsAuthenticated(!!session);
        setLoading(false);
      }
    );

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [supabase]);

  return { supabase, user, loading, session, getAccessToken, isAuthenticated };
}

export default useSupabase;
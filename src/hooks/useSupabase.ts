'use client';

import { useState, useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { type SupabaseClient } from '@supabase/supabase-js';

export default function useSupabase() {
  const [supabase] = useState<SupabaseClient>(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
      } catch (error) {
        console.error('Error getting user:', error);
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
        setLoading(false);
      }
    );

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [supabase]);

  return { supabase, user, loading };
} 
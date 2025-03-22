import { createClient } from '@supabase/supabase-js';

// Create a single supabase client for the browser
export const createSupabaseBrowserClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and anon key must be defined');
  }

  return createClient(supabaseUrl, supabaseKey);
};
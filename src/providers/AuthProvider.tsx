'use client';

import { useSupabase } from '@/hooks/useSupabase';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Define which routes require authentication
const PROTECTED_ROUTES = ['/dashboard', '/transcribe', '/analyze'];
// Define public routes
const PUBLIC_ROUTES = ['/', '/auth'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { supabase } = useSupabase();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setIsAuthenticated(!!session);
        
        const isProtectedRoute = PROTECTED_ROUTES.some(route => 
          pathname.startsWith(route)
        );
        
        if (!session && isProtectedRoute) {
          router.push('/');
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    // Check auth on initial load
    checkAuth();

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const isAuthed = !!session;
      setIsAuthenticated(isAuthed);
      
      if (event === 'SIGNED_OUT') {
        router.push('/');
      } else if (event === 'SIGNED_IN' && PUBLIC_ROUTES.includes(pathname)) {
        router.push('/dashboard');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, router, pathname]);

  if (isLoading) {
    // You could return a loading spinner here
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return <>{children}</>;
}

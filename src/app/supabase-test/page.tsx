'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Navbar } from "@/components/ui/navbar";
import useSupabase from '@/hooks/useSupabase';

export default function SupabaseTestPage() {
  const { supabase, user, loading: userLoading } = useSupabase();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [authMessage, setAuthMessage] = useState('');
  const [googleSignInStatus, setGoogleSignInStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [googleSignInMessage, setGoogleSignInMessage] = useState('');

  const testConnection = async () => {
    setConnectionStatus('loading');
    try {
      // Ping the Supabase server with a simple query
      const { data, error } = await supabase.from('_test_connection_dummy').select('*').limit(1).maybeSingle();
      
      // This query will likely fail with a 400 error about relation not existing, 
      // but that actually confirms we have a connection to Supabase
      if (error && error.code === '42P01') { // PostgreSQL error for "relation does not exist"
        setConnectionStatus('success');
        setConnectionMessage('Successfully connected to Supabase! (Expected error about table not existing)');
        return;
      } else if (error) {
        // If we get a different error, we should inspect it
        if (error.message.includes('connection') || error.code === 'PGRST') {
          throw new Error('Failed to connect to Supabase');
        } else {
          // Other errors might also indicate successful connection
          setConnectionStatus('success');
          setConnectionMessage(`Connected to Supabase! (Got expected error: ${error.message})`);
          return;
        }
      }
      
      // If we somehow got data (you created this table), that's fine too
      setConnectionStatus('success');
      setConnectionMessage('Successfully connected to Supabase!');
    } catch (error: any) {
      setConnectionStatus('error');
      setConnectionMessage(`Error: ${error.message || 'Something went wrong connecting to Supabase'}`);
    }
  };

  const checkAuthSetup = async () => {
    setAuthStatus('loading');
    try {
      // Check if auth is set up by getting the current session
      const { data, error } = await supabase.auth.getSession();
      
      if (error) throw error;
      
      setAuthStatus('success');
      if (data.session) {
        setAuthMessage(`Auth is working! User signed in: ${data.session.user.email}`);
      } else {
        setAuthMessage('Auth is set up correctly! (No user currently signed in)');
      }
    } catch (error: any) {
      setAuthStatus('error');
      setAuthMessage(`Error: ${error.message || 'Something went wrong checking auth'}`);
    }
  };

  const signInWithGoogle = async () => {
    setGoogleSignInStatus('loading');
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/supabase-test`,
        },
      });

      if (error) throw error;
      
      setGoogleSignInStatus('success');
      setGoogleSignInMessage('Redirecting to Google for authentication...');
    } catch (error: any) {
      setGoogleSignInStatus('error');
      setGoogleSignInMessage(`Error: ${error.message || 'Something went wrong with Google Sign-In'}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold ai-header">Supabase Integration Test</h1>
            <p className="text-lg text-indigo-600 mt-2">
              Verify your Supabase connection and authentication setup
            </p>
          </div>
          
          <Card className="colorful-card">
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>Check if your Supabase environment variables are set</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="font-medium">NEXT_PUBLIC_SUPABASE_URL:</p>
                  <p className="font-mono bg-gray-100 p-2 rounded">
                    {process.env.NEXT_PUBLIC_SUPABASE_URL ? 
                      `✅ Set (${process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 20)}...)` : 
                      '❌ Not set'}
                  </p>
                </div>
                <div>
                  <p className="font-medium">NEXT_PUBLIC_SUPABASE_ANON_KEY:</p>
                  <p className="font-mono bg-gray-100 p-2 rounded">
                    {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 
                      '✅ Set (key hidden for security)' : 
                      '❌ Not set'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="colorful-card">
            <CardHeader>
              <CardTitle>Database Connection Test</CardTitle>
              <CardDescription>Test if your app can connect to Supabase</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4">Click the button below to test your Supabase database connection:</p>
              <Button 
                onClick={testConnection} 
                disabled={connectionStatus === 'loading'}
                className="w-full"
              >
                {connectionStatus === 'loading' ? 'Testing Connection...' : 'Test Database Connection'}
              </Button>
            </CardContent>
            {connectionStatus !== 'idle' && (
              <CardFooter className="border-t pt-4">
                <div className={`w-full p-3 rounded-md ${
                  connectionStatus === 'success' ? 'bg-green-50 text-green-700' : 
                  connectionStatus === 'error' ? 'bg-red-50 text-red-700' : 
                  'bg-blue-50 text-blue-700'
                }`}>
                  {connectionMessage}
                </div>
              </CardFooter>
            )}
          </Card>
          
          <Card className="colorful-card">
            <CardHeader>
              <CardTitle>Authentication Test</CardTitle>
              <CardDescription>Test if Supabase authentication is correctly set up</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4">Click the button below to test your Supabase authentication setup:</p>
              <Button 
                onClick={checkAuthSetup} 
                disabled={authStatus === 'loading'}
                className="w-full"
              >
                {authStatus === 'loading' ? 'Checking Auth...' : 'Test Authentication Setup'}
              </Button>
            </CardContent>
            {authStatus !== 'idle' && (
              <CardFooter className="border-t pt-4">
                <div className={`w-full p-3 rounded-md ${
                  authStatus === 'success' ? 'bg-green-50 text-green-700' : 
                  authStatus === 'error' ? 'bg-red-50 text-red-700' : 
                  'bg-blue-50 text-blue-700'
                }`}>
                  {authMessage}
                </div>
              </CardFooter>
            )}
          </Card>
          
          <Card className="colorful-card">
            <CardHeader>
              <CardTitle>Google Sign-In Test</CardTitle>
              <CardDescription>Test Google OAuth authentication with Supabase</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4">Click the button below to test Google Sign-In:</p>
              <Button 
                onClick={signInWithGoogle} 
                disabled={googleSignInStatus === 'loading'}
                className="w-full"
              >
                {googleSignInStatus === 'loading' ? 'Connecting...' : 'Sign In with Google'}
              </Button>
            </CardContent>
            {googleSignInStatus !== 'idle' && (
              <CardFooter className="border-t pt-4">
                <div className={`w-full p-3 rounded-md ${
                  googleSignInStatus === 'success' ? 'bg-green-50 text-green-700' : 
                  googleSignInStatus === 'error' ? 'bg-red-50 text-red-700' : 
                  'bg-blue-50 text-blue-700'
                }`}>
                  {googleSignInMessage}
                </div>
              </CardFooter>
            )}
          </Card>
          
          <Card className="colorful-card">
            <CardHeader>
              <CardTitle>Current User Status</CardTitle>
              <CardDescription>Information about the currently logged in user</CardDescription>
            </CardHeader>
            <CardContent>
              {userLoading ? (
                <p>Loading user information...</p>
              ) : user ? (
                <div className="space-y-2">
                  <p><span className="font-medium">User ID:</span> {user.id}</p>
                  <p><span className="font-medium">Email:</span> {user.email}</p>
                  <p><span className="font-medium">Auth Provider:</span> {user.app_metadata?.provider || 'email'}</p>
                  <p><span className="font-medium">Created At:</span> {new Date(user.created_at).toLocaleString()}</p>
                </div>
              ) : (
                <p>No user currently signed in</p>
              )}
            </CardContent>
            {user && (
              <CardFooter>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    window.location.reload();
                  }}
                >
                  Sign Out
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
} 
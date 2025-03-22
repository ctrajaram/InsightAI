'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useSupabase from '@/hooks/useSupabase';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/ui/navbar';
import { Loader2, LogIn, Mail, Check, AlertTriangle } from 'lucide-react';

export default function LoginPage() {
  const { supabase, user, loading } = useSupabase();
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [email, setEmail] = useState('');
  const [loginSent, setLoginSent] = useState(false);
  const [returnUrl, setReturnUrl] = useState('/dashboard');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const returnPath = params.get('returnUrl');
      if (returnPath) {
        setReturnUrl(returnPath);
      }
    }
  }, []);

  useEffect(() => {
    if (user && !loading) {
      router.push(returnUrl);
    }
  }, [user, loading, router, returnUrl]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    
    if (!email || !email.includes('@')) {
      setAuthError('Please enter a valid email address');
      return;
    }
    
    try {
      setIsLoggingIn(true);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) {
        throw error;
      }
      
      setLoginSent(true);
    } catch (error: any) {
      console.error('Login error:', error);
      setAuthError(error.message || 'Failed to send login link');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      setIsSigningUp(true);
      setAuthError(null);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?returnUrl=${returnUrl}`,
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      setAuthError(error.message || 'Failed to sign in with Google');
      setIsSigningUp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-lg">Checking authentication status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600">
              <Check className="h-6 w-6" />
              <p className="text-lg font-medium">You are logged in!</p>
            </div>
            <p className="text-muted-foreground">Redirecting to {returnUrl}...</p>
            <Button onClick={() => router.push(returnUrl)}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="mx-auto w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Sign in</CardTitle>
            <CardDescription>
              Sign in to your account to use all features
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {authError && (
              <div className="rounded-md bg-red-50 p-3 text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                <p className="text-sm">{authError}</p>
              </div>
            )}
            
            {loginSent ? (
              <div className="rounded-md bg-green-50 p-4 text-green-600">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5" />
                  <p className="font-medium">Check your email</p>
                </div>
                <p className="mt-2 text-sm">
                  We've sent a magic link to <span className="font-medium">{email}</span>.
                  Click the link in the email to sign in.
                </p>
              </div>
            ) : (
              <>
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="your.email@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending link...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Sign in with Email
                      </>
                    )}
                  </Button>
                </form>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>
                
                <Button
                  variant="outline"
                  onClick={signInWithGoogle}
                  disabled={isSigningUp}
                  className="w-full"
                >
                  {isSigningUp ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg
                        className="mr-2 h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                      Sign in with Google
                    </>
                  )}
                </Button>
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-col items-center">
            <p className="text-center text-sm text-muted-foreground">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
} 
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useSupabase from '@/hooks/useSupabase';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/ui/navbar';
import { Loader2, LogIn, Mail, Check, AlertTriangle, User } from 'lucide-react';
import Link from 'next/link';

export default function SignupPage() {
  const { supabase, user, loading } = useSupabase();
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [email, setEmail] = useState('');
  const [signupSent, setSignupSent] = useState(false);
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

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    
    if (!email || !email.includes('@')) {
      setAuthError('Please enter a valid email address');
      return;
    }
    
    try {
      setIsSigningUp(true);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) {
        throw error;
      }
      
      setSignupSent(true);
    } catch (error: any) {
      console.error('Signup error:', error);
      setAuthError(error.message || 'Failed to send signup link');
    } finally {
      setIsSigningUp(false);
    }
  };

  const signUpWithGoogle = async () => {
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
      console.error('Google sign-up error:', error);
      setAuthError(error.message || 'Failed to sign up with Google');
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

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {signupSent ? (
            <Card className="border-indigo-100 shadow-md">
              <CardHeader className="pb-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle className="text-center text-xl mt-4">Check your email</CardTitle>
                <CardDescription className="text-center">
                  We've sent a sign-up link to <span className="font-medium">{email}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm text-gray-500">
                <p>Click the link in your email to sign up. If you don't see it, check your spam folder.</p>
              </CardContent>
              <CardFooter>
                <div className="w-full space-y-3">
                  <Button 
                    onClick={() => setSignupSent(false)} 
                    className="w-full"
                    variant="outline"
                  >
                    Use a different email
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ) : (
            <Card className="border-indigo-100 shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Create an account</CardTitle>
                <CardDescription>
                  Sign up to access InsightAI's powerful analytics tools
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {authError && (
                  <div className="rounded-md bg-red-50 p-3 text-red-800 text-sm flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
                    {authError}
                  </div>
                )}
                
                <form onSubmit={handleEmailSignup} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                    disabled={isSigningUp}
                  >
                    {isSigningUp ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending link...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Continue with Email
                      </>
                    )}
                  </Button>
                </form>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-2 text-gray-500">or continue with</span>
                  </div>
                </div>
                
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={signUpWithGoogle}
                  disabled={isSigningUp}
                >
                  {isSigningUp ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                      <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
                    </svg>
                  )}
                  Google
                </Button>
              </CardContent>
              <CardFooter className="flex justify-center">
                <div className="text-sm text-center">
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Sign in
                  </Link>
                </div>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

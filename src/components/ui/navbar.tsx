'use client';

import Link from 'next/link';
import { Button } from './button';
import useSupabase from '@/hooks/useSupabase';
import { useState, useEffect, useRef } from 'react';
import { Loader2, LogIn, LogOut, User } from 'lucide-react';

export default function Navbar() {
  const { user, loading, supabase } = useSupabase();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error logging out:', error);
    } finally {
      setIsLoggingOut(false);
      setShowDropdown(false);
    }
  };

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className="bg-white border-b">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold text-xl">
            InsightAI
          </Link>
          <nav className="hidden md:flex gap-6">
            <Link href="/" className="text-sm font-medium hover:underline">
              Home
            </Link>
            <Link
              href="/media-transcription"
              className="text-sm font-medium hover:underline"
            >
              Transcription
            </Link>
            <Link href="/api-setup" className="text-sm font-medium hover:underline">
              API Setup
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : user ? (
            <div className="relative" ref={dropdownRef}>
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <User className="h-4 w-4" />
                <span className="hidden md:inline-block max-w-[120px] truncate">
                  {user.email}
                </span>
              </Button>
              
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border z-50">
                  <div className="py-1">
                    <div className="px-4 py-2 text-sm font-semibold border-b">
                      My Account
                    </div>
                    <button 
                      className="w-full text-left px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
                      disabled
                    >
                      Profile
                    </button>
                    <button 
                      className="w-full text-left px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
                      disabled
                    >
                      Settings
                    </button>
                    <div className="border-t my-1"></div>
                    <button 
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      {isLoggingOut ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Signing out...
                        </>
                      ) : (
                        <>
                          <LogOut className="mr-2 h-4 w-4" />
                          Sign out
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button size="sm" variant="ghost" className="gap-2">
                  <LogIn className="h-4 w-4" />
                  Sign in
                </Button>
              </Link>
              <Link href="/login">
                <Button size="sm">Sign up</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
} 
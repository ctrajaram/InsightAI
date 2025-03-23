'use client';

import Link from 'next/link';
import { Button } from './button';
import useSupabase from '@/hooks/useSupabase';
import { useState, useEffect, useRef } from 'react';
import { Loader2, LogIn, LogOut, User, Menu, X, Home, BarChart2, FileText, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Navbar() {
  const { user, loading, supabase } = useSupabase();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

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

  // Handle click outside to close dropdown and mobile menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node) 
          && event.target !== document.querySelector('.mobile-menu-button')) {
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const menuLinks = [
    { href: '/', label: 'Home', icon: <Home className="h-4 w-4 mr-2" /> },
    { href: '/dashboard', label: 'Dashboard', icon: <BarChart2 className="h-4 w-4 mr-2" /> },
    { href: '/transcribe', label: 'Transcribe', icon: <FileText className="h-4 w-4 mr-2" /> },
  ];

  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b shadow-sm">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold text-xl flex items-center">
            <span className="bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">InsightAI</span>
          </Link>
          
          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {menuLinks.map((link) => (
              <Link 
                key={link.href}
                href={link.href} 
                className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors flex items-center"
              >
                {link.icon}
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Mobile menu button */}
        <button 
          className="md:hidden flex items-center justify-center mobile-menu-button" 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6 text-gray-700" />
          ) : (
            <Menu className="h-6 w-6 text-gray-700" />
          )}
        </button>

        {/* Authentication section */}
        <div className="hidden md:flex items-center gap-2">
          {loading ? (
            <Button disabled variant="outline" size="sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading
            </Button>
          ) : user ? (
            <div className="relative" ref={dropdownRef}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 hover:bg-gray-100"
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-100 text-indigo-600">
                  <User className="h-4 w-4" />
                </div>
                <span className="max-w-[100px] truncate">{user.email}</span>
              </Button>
              
              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                  >
                    <div className="py-1">
                      <p className="px-4 py-2 text-sm text-gray-500 truncate">
                        {user.email}
                      </p>
                      <hr className="my-1" />
                      <button
                        onClick={handleLogout}
                        className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              <Button asChild size="sm" variant="outline" className="border-indigo-600 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
                <Link href="/signup" className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  Sign Up
                </Link>
              </Button>
              <Button asChild size="sm" variant="default" className="bg-indigo-600 hover:bg-indigo-700">
                <Link href="/login" className="flex items-center gap-1">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            ref={mobileMenuRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden border-t overflow-hidden"
          >
            <div className="py-4 px-4 space-y-4">
              <nav className="flex flex-col space-y-3">
                {menuLinks.map((link) => (
                  <Link 
                    key={link.href}
                    href={link.href} 
                    className="flex items-center py-2 px-3 rounded-md text-gray-700 hover:bg-gray-100 hover:text-indigo-600"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.icon}
                    {link.label}
                  </Link>
                ))}
              </nav>
              
              {/* Mobile auth section */}
              {loading ? (
                <Button disabled variant="outline" size="sm" className="w-full">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </Button>
              ) : user ? (
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center pb-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-100 text-indigo-600 mr-2">
                      <User className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-medium truncate">{user.email}</p>
                  </div>
                  <Button 
                    onClick={handleLogout} 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
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
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button asChild size="sm" variant="outline" className="w-full border-indigo-600 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
                    <Link href="/signup" className="flex items-center justify-center">
                      <User className="mr-2 h-4 w-4" />
                      Sign Up
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="default" className="w-full bg-indigo-600 hover:bg-indigo-700">
                    <Link href="/login" className="flex items-center justify-center">
                      <LogIn className="mr-2 h-4 w-4" />
                      Sign In
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
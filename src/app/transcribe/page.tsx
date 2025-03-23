'use client';

import React from 'react';
import Navbar from '@/components/ui/navbar';
import { MediaUploader } from '@/components/MediaUploader';
import useSupabase from '@/hooks/useSupabase';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';

export default function TranscribePage() {
  const { user, loading } = useSupabase();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <header className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Interview Transcription</h1>
              <p className="text-gray-600">
                Upload audio or video files of customer interviews for automatic transcription and analysis.
              </p>
            </header>
          </motion.div>

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
          ) : !user ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center border border-gray-200">
              <div className="mx-auto w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-indigo-500" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
              <p className="text-gray-600 mb-6">
                Please sign in to use the transcription feature
              </p>
              <Button asChild>
                <a href="/login">Sign In</a>
              </Button>
            </div>
          ) : (
            <MediaUploader />
          )}
        </div>
      </main>
    </div>
  );
}

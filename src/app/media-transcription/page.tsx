'use client';

import { useState } from 'react';
import Link from 'next/link';
import Navbar from "@/components/ui/navbar";
import MediaUploader from '@/components/MediaUploader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { TranscriptionRecord } from '@/lib/media-storage';
import useSupabase from '@/hooks/useSupabase';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Sparkles, Download, Share2, AlertCircle } from 'lucide-react';

export default function MediaTranscriptionPage() {
  const { user, loading } = useSupabase();
  const [completedTranscription, setCompletedTranscription] = useState<TranscriptionRecord | null>(null);

  const handleTranscriptionComplete = (transcription: TranscriptionRecord) => {
    setCompletedTranscription(transcription);
  };

  const downloadTranscript = () => {
    if (!completedTranscription) return;
    
    const content = completedTranscription.transcriptionText;
    const filename = `transcript-${completedTranscription.fileName.split('.')[0]}.txt`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    
    // Create download link and trigger click
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadSummary = () => {
    if (!completedTranscription || !completedTranscription.summaryText) return;
    
    const content = completedTranscription.summaryText;
    const filename = `summary-${completedTranscription.fileName.split('.')[0]}.txt`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    
    // Create download link and trigger click
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="container mt-8 mb-12 px-4 md:px-6">
        <div className="grid gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">Media Transcription</h1>
            <p className="text-muted-foreground">
              Upload your MP3 files and get them transcribed using AI.
            </p>
          </div>
          
          {!loading && !user && (
            <Card className="mb-6 border-amber-500">
              <CardHeader className="flex flex-row items-center gap-4">
                <AlertCircle className="h-8 w-8 text-amber-500" />
                <div>
                  <CardTitle>Authentication Required</CardTitle>
                  <CardDescription>
                    You must be signed in to use the media transcription feature
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-4">Transcription requires authentication to track your uploads and transcriptions.</p>
                <div className="flex justify-center">
                  <Link href="/login?returnUrl=/media-transcription">
                    <Button className="bg-amber-500 hover:bg-amber-600">
                      Sign In Now
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle>Upload Media</CardTitle>
              <CardDescription>
                Upload an MP3 file to get it transcribed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaUploader onComplete={handleTranscriptionComplete} />
            </CardContent>
          </Card>
          
          {completedTranscription && completedTranscription.summaryStatus === 'completed' && (
            <Card className="mt-8 overflow-hidden border-purple-200">
              <div className="bg-gradient-to-r from-purple-100 to-indigo-50 border-b">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" />
                    <span>AI-Generated Summary</span>
                  </CardTitle>
                  <CardDescription>
                    File: {completedTranscription.fileName}
                  </CardDescription>
                </CardHeader>
              </div>
              <CardContent className="pt-6">
                <div className="bg-white p-5 rounded-md whitespace-pre-wrap prose max-w-none">
                  {completedTranscription.summaryText}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2 border-t bg-gray-50 py-3">
                <Button
                  variant="outline" 
                  size="sm" 
                  className="flex items-center gap-1"
                  onClick={downloadSummary}
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </Button>
                <Button
                  variant="outline" 
                  size="sm" 
                  className="flex items-center gap-1"
                >
                  <Share2 className="h-4 w-4" />
                  <span>Share</span>
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
} 
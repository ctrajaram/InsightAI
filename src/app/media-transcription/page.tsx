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
import { FileText, Sparkles, Download, Share2, AlertCircle, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
            <h1 className="text-3xl font-bold">Media Transcription & Analysis</h1>
            <p className="text-muted-foreground">
              Upload audio or video files and get AI-powered transcriptions, summaries, and insights.
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
                Supported formats: MP3, MP4, WAV, M4A (max 25MB)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaUploader onComplete={handleTranscriptionComplete} />
            </CardContent>
          </Card>
          
          {completedTranscription && completedTranscription.summaryStatus === 'completed' && (
            <div className="grid gap-4">
              <div className="flex items-center">
                <h2 className="text-xl font-semibold">Transcription & Insights</h2>
                <div className="h-px flex-1 bg-border ml-4"></div>
              </div>
              
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                      <FileText className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">Transcription</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-white p-5 rounded-md whitespace-pre-wrap prose max-w-none">
                      {completedTranscription.transcriptionText}
                    </div>
                  </CardContent>
                  <CardFooter className="flex justify-end gap-2 border-t bg-gray-50 py-3">
                    <Button
                      variant="outline" 
                      size="sm" 
                      className="flex items-center gap-1"
                      onClick={downloadTranscript}
                    >
                      <Download className="h-4 w-4" />
                      <span>Download</span>
                    </Button>
                  </CardFooter>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                      <Sparkles className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">Summarization</CardTitle>
                  </CardHeader>
                  <CardContent>
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
                  </CardFooter>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                      <TrendingUp className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">Insights Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="positive" className="w-20 justify-center">Positive</Badge>
                        <span className="text-sm text-muted-foreground">Customer is satisfied and expresses positive opinions</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="neutral" className="w-20 justify-center">Neutral</Badge>
                        <span className="text-sm text-muted-foreground">Customer expresses balanced or mixed opinions</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="negative" className="w-20 justify-center">Negative</Badge>
                        <span className="text-sm text-muted-foreground">Customer expresses dissatisfaction or frustration</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
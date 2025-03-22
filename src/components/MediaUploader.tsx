'use client';

import React, { useState, useEffect } from 'react';
import { FileUpload } from './ui/file-upload';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Loader2, AudioWaveform, Video, Check, AlertCircle, FileText, Sparkles, AlertTriangle, X, FileAudio, Clock, CheckCircle } from 'lucide-react';
import useSupabase from '@/hooks/useSupabase';
import { 
  TranscriptionRecord, 
  uploadMediaFile,
  createTranscriptionRecord
} from '@/lib/media-storage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import Link from 'next/link';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Progress } from './ui/progress';

export default function MediaUploader({ onComplete }: { onComplete?: (transcription: TranscriptionRecord) => void }) {
  const { supabase, user } = useSupabase();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [transcriptionRecord, setTranscriptionRecord] = useState<TranscriptionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<'pending' | 'processing' | 'completed' | 'error'>('pending');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement> | File[]) => {
    // Handle both direct file array and input change event
    let files: File[] = [];
    
    if (Array.isArray(event)) {
      files = event;
    } else if (event.target.files) {
      files = Array.from(event.target.files);
    }
    
    if (files.length === 0) return;
    
    // If already selected, don't reselect
    if (selectedFile && selectedFile.name === files[0].name && selectedFile.size === files[0].size) {
      console.log('Same file already selected, ignoring');
      return;
    }
    
    // Debug file info
    console.log('File selected:', {
      name: files[0].name,
      type: files[0].type,
      size: files[0].size
    });
    
    setSelectedFile(files[0]);
    setError(null);
  };

  const handleUpload = async (event?: React.MouseEvent<HTMLButtonElement> | React.FormEvent) => {
    // Prevent any potential event bubbling
    if (event) {
      event.preventDefault();
    }
    
    // Debug log to track function calls
    console.log('handleUpload called, current file:', selectedFile?.name);
    
    if (!selectedFile || !user) {
      setError('You must be logged in to upload files. Please sign in first.');
      return;
    }
    
    // If already uploading or transcribing, prevent double processing
    if (isUploading || isTranscribing || isSubmitting) {
      console.log('Upload or transcription already in progress, ignoring duplicate call');
      return;
    }
    
    try {
      // Set submission lock
      setIsSubmitting(true);
      setIsUploading(true);
      setUploadProgress(0);
      setError(null);
      
      // Disable form elements to prevent resubmission
      const form = document.getElementById('upload-form') as HTMLFormElement;
      if (form) {
        const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (submitButton) {
          submitButton.disabled = true;
        }
      }
      
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 300);
      
      // Upload file to Supabase storage
      console.log('Starting file upload to Supabase...');
      const fileInfo = await uploadMediaFile(selectedFile, user.id);
      console.log('File uploaded successfully, creating record...');
      
      // Create transcription record in database
      try {
        const record = await createTranscriptionRecord(fileInfo, user.id);
        console.log('Transcription record created:', record.id);
        
        // Wait 2 seconds to make sure the record propagates through the database
        console.log('Waiting for database propagation...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify the record was created in the database
        const { data: verifyRecord, error: verifyError } = await supabase
          .from('transcriptions')
          .select('id, status')
          .eq('id', record.id)
          .single();
          
        if (verifyError || !verifyRecord) {
          console.error('Failed to verify record creation:', verifyError);
          throw new Error('Transcription record was not properly created in the database. Please try again.');
        }
        
        console.log('Verified record exists in database:', verifyRecord);
        
        setTranscriptionRecord(record);
        clearInterval(progressInterval);
        setUploadProgress(100);
        
        // Start transcription with all data needed
        console.log('Starting transcription with verified record...');
        await startTranscription(record.id, record.mediaUrl);
      } catch (recordErr: any) {
        console.error('Error creating or verifying transcription record:', recordErr);
        setError('Failed to create transcription record: ' + recordErr.message);
        clearInterval(progressInterval);
        setUploadProgress(0);
        throw recordErr; // Rethrow to be caught by the outer catch
      }
      
    } catch (err: any) {
      let errorMsg = err.message || 'An error occurred during upload';
      
      // Check for authentication error
      if (errorMsg.includes('Unauthorized') || errorMsg.includes('auth')) {
        errorMsg = 'Authentication error: Please sign in again and try once more.';
      }
      
      setError(errorMsg);
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
      setIsSubmitting(false);
    }
  };

  const startTranscription = async (transcriptionId: string, mediaUrl: string) => {
    if (!transcriptionId || !mediaUrl) return;
    
    try {
      setIsTranscribing(true);
      setTranscriptionStatus('processing');
      
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('You must be logged in to transcribe media. Please sign in and try again.');
      }
      
      // Make one more check to verify the record exists in the database
      console.log('Verifying record exists before sending to API...');
      const { data: existingRecord, error: recordError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', transcriptionId)
        .single();
        
      if (recordError || !existingRecord) {
        console.error('Record not found before API call:', recordError);
        throw new Error('The transcription record could not be found. Please try uploading again.');
      }
      
      console.log('Record confirmed to exist, sending to API:', existingRecord.id);
      
      // Send to our transcription API endpoint with the access token and record details
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          transcriptionId,
          mediaUrl,
          accessToken: session.access_token,
          record: existingRecord // Send the full record for extra safety
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error || 'Failed to transcribe media';
        
        // Check for OpenAI API key errors
        if (errorMessage.includes('OpenAI API key') || errorMessage.includes('API key')) {
          throw new Error('OpenAI API key is missing or invalid. Please visit /api-setup to configure your API key.');
        }
        
        // Check for authorization errors
        if (response.status === 401) {
          throw new Error('You must be logged in to transcribe media. Please sign in and try again.');
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      // Verify that the database was updated correctly
      console.log('Verifying transcription status in database...');
      const { data: verifyData, error: verifyError } = await supabase
        .from('transcriptions')
        .select('id, status, transcription_text')
        .eq('id', transcriptionId)
        .single();
        
      if (verifyError) {
        console.error('Failed to verify transcription status:', verifyError);
      } else {
        console.log('Verified transcription record:', verifyData);
        
        // If the status is still "processing", try to update it directly
        if (verifyData.status === 'processing' && data.text) {
          console.log('Status still showing processing, attempting direct update...');
          
          const { error: updateError } = await supabase
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: data.text,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          if (updateError) {
            console.error('Direct update failed:', updateError);
          } else {
            console.log('Direct update successful');
          }
        }
      }
      
      // Update transcription status to completed
      setTranscriptionStatus('completed');
      
      // Update the transcription record with the new transcript text
      const updatedRecord: TranscriptionRecord = {
        ...transcriptionRecord!,
        transcriptionText: data.text,
        status: 'completed',
      };
      
      setTranscriptionRecord(updatedRecord);
      
      console.log('Transcription completed successfully');
      
      // Automatically start the summarization process
      console.log('Starting automatic summarization...');
      try {
        await generateSummaryForTranscription(transcriptionId, data.text);
      } catch (summaryError) {
        console.error('Failed to generate summary:', summaryError);
        // Continue with the process even if summarization fails
      }
      
      // Only call onComplete once after transcription is successful, if the callback exists
      if (onComplete && typeof onComplete === 'function') {
        // Use setTimeout to ensure state is updated before callback
        setTimeout(() => {
          onComplete(updatedRecord);
        }, 0);
      }
      
    } catch (err: any) {
      console.error('Transcription error:', err);
      setError(err.message || 'An error occurred during transcription');
      setTranscriptionStatus('error');
      
      // Update the transcription record with the error
      setTranscriptionRecord(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          status: 'error',
          error: err.message,
        };
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const generateSummaryForTranscription = async (transcriptionId: string, transcriptionText: string) => {
    try {
      setIsSummarizing(true);
      
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('You must be logged in to generate a summary. Please sign in and try again.');
      }
      
      console.log('Sending transcription to summarization API...');
      
      // Call the summary generation API
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          transcriptionId,
          transcriptionText,
          accessToken: session.access_token
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate summary');
      }
      
      const data = await response.json();
      console.log('Summary generated successfully');
      
      // Verify that the database was updated correctly
      console.log('Verifying summary status in database...');
      const { data: verifyData, error: verifyError } = await supabase
        .from('transcriptions')
        .select('id, summary_status, summary_text')
        .eq('id', transcriptionId)
        .single();
        
      if (verifyError) {
        console.error('Failed to verify summary status:', verifyError);
      } else {
        console.log('Verified summary record:', verifyData);
        
        // If the status is still not "completed", try to update it directly
        if (verifyData.summary_status !== 'completed' && data.summary.text) {
          console.log('Status not showing completed, attempting direct update...');
          
          const { error: updateError } = await supabase
            .from('transcriptions')
            .update({
              summary_status: 'completed',
              summary_text: data.summary.text,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          if (updateError) {
            console.error('Direct update failed:', updateError);
          } else {
            console.log('Direct update successful');
          }
        }
      }
      
      // Update the local transcription record with the summary
      if (transcriptionRecord) {
        setTranscriptionRecord({
          ...transcriptionRecord,
          summaryText: data.summary.text,
          summaryStatus: 'completed' as const
        });
      }
      
      return data.summary.text;
    } catch (err: any) {
      console.error('Summary generation error:', err);
      if (transcriptionRecord) {
        setTranscriptionRecord({
          ...transcriptionRecord,
          summaryStatus: 'error' as const,
          error: err.message
        });
      }
      throw err;
    } finally {
      setIsSummarizing(false);
    }
  };

  const renderFileInfo = () => {
    if (!selectedFile) return null;
    
    const isAudio = selectedFile.type.startsWith('audio/');
    const isVideo = selectedFile.type.startsWith('video/');
    const icon = isAudio ? <AudioWaveform size={24} /> : isVideo ? <Video size={24} /> : null;
    const sizeMB = (selectedFile.size / (1024 * 1024)).toFixed(2);
    
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{selectedFile.name}</p>
          <p className="text-xs text-muted-foreground">{sizeMB} MB</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedFile(null)}
          disabled={isUploading || isTranscribing}
        >
          Change
        </Button>
      </div>
    );
  };

  const renderStatus = () => {
    if (error) {
      return (
        <div className="flex items-center gap-2 text-red-500 p-3 bg-red-50 rounded-md">
          <AlertTriangle className="h-5 w-5 mr-2" />
          <p className="text-sm">{error}</p>
        </div>
      );
    }
    
    if (isTranscribing) {
      return (
        <div className="flex items-center gap-2 text-blue-500 p-3 bg-blue-50 rounded-md">
          <Loader2 size={18} className="animate-spin" />
          <p className="text-sm">Transcribing your file. This may take a few minutes...</p>
        </div>
      );
    }

    if (isSummarizing) {
      return (
        <div className="flex items-center gap-2 text-purple-500 p-3 bg-purple-50 rounded-md">
          <Loader2 size={18} className="animate-spin" />
          <p className="text-sm">Generating AI summary of your transcription...</p>
        </div>
      );
    }
    
    if (transcriptionRecord?.status === 'completed') {
      return (
        <div className="flex items-center gap-2 text-green-500 p-3 bg-green-50 rounded-md">
          <Check size={18} />
          <p className="text-sm">
            Transcription complete! 
            {transcriptionRecord.summaryStatus === 'completed' && ' Summary generated.'}
          </p>
        </div>
      );
    }
    
    return null;
  };

  const renderTranscriptionContent = () => {
    if (!transcriptionRecord?.transcriptionText) return null;

    return (
      <div className="mt-4">
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="summary" disabled={!transcriptionRecord.summaryText}>
              <div className="flex items-center gap-2">
                <Sparkles size={16} />
                <span>AI Summary</span>
              </div>
            </TabsTrigger>
            <TabsTrigger value="fullTranscript">
              <div className="flex items-center gap-2">
                <FileText size={16} />
                <span>Full Transcript</span>
              </div>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="summary" className="mt-2">
            {transcriptionRecord.summaryStatus === 'completed' ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" />
                    AI-Generated Summary
                  </CardTitle>
                  <CardDescription>Generated with OpenAI GPT-4</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="p-4 bg-purple-50 rounded-md whitespace-pre-wrap prose max-w-none">
                    {transcriptionRecord.summaryText}
                  </div>
                </CardContent>
                <CardFooter className="pt-0 text-xs text-muted-foreground">
                  <p>The summary is generated automatically using AI and may not capture all details.</p>
                </CardFooter>
              </Card>
            ) : transcriptionRecord.summaryStatus === 'processing' ? (
              <div className="animate-pulse">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                        Generating Summary...
                      </CardTitle>
                    </div>
                    <CardDescription>Using OpenAI GPT-4 to analyze your transcript</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="h-4 bg-muted rounded w-3/4"></div>
                      <div className="h-4 bg-muted rounded w-full"></div>
                      <div className="h-4 bg-muted rounded w-5/6"></div>
                      <div className="h-4 bg-muted rounded w-2/3"></div>
                      <div className="h-4 bg-muted rounded w-4/5"></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex items-center justify-center p-6 bg-muted/20 rounded-md">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                  <p className="font-medium">Summary generation failed</p>
                  <p className="text-sm text-center max-w-md">
                    {transcriptionRecord.error || "There was an error generating the summary. Please try again."}
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => generateSummaryForTranscription(transcriptionRecord.id, transcriptionRecord.transcriptionText)}
                    disabled={isSummarizing}
                  >
                    {isSummarizing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Retrying...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Try Again
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="fullTranscript" className="mt-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Full Transcript</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-gray-50 rounded-md whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {transcriptionRecord.transcriptionText}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  };

  // Cleanup function for component unmount
  useEffect(() => {
    // Return cleanup function to handle component unmounting
    return () => {
      // Cancel any in-progress operations if component unmounts
      setIsUploading(false);
      setIsTranscribing(false);
      setIsSummarizing(false);
    };
  }, []);

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-700 mb-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <div>{error}</div>
          </div>
          {error.includes('API key') && (
            <div className="mt-2">
              <Link href="/api-setup" className="text-red-700 font-medium underline">
                Go to API Setup Page →
              </Link>
            </div>
          )}
          {error.includes('sign in') && (
            <div className="mt-2">
              <Link href="/login?returnUrl=/media-transcription" className="text-red-700 font-medium underline">
                Go to Login Page →
              </Link>
            </div>
          )}
        </div>
      )}
      
      <form 
        id="upload-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (selectedFile && !isUploading && !isTranscribing) {
            handleUpload(e);
          }
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid w-full max-w-sm items-center gap-1.5">
          <Label htmlFor="file">Media file</Label>
          <Input
            id="file"
            type="file"
            accept="audio/mp3,audio/mpeg"
            disabled={isUploading || isTranscribing}
            className="cursor-pointer"
            onClick={(e) => {
              // Reset value if already has a file to ensure change event fires
              const input = e.currentTarget as HTMLInputElement;
              if (input.value) {
                input.value = '';
              }
            }}
            onChange={handleFileSelected}
          />
          <p className="text-sm text-muted-foreground">
            MP3 files up to 25MB
          </p>
        </div>
        
        {selectedFile && (
          <div className="border rounded-md p-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                <FileAudio className="h-5 w-5 mr-2 text-blue-500" />
                <div>
                  <div className="font-medium">{selectedFile.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setSelectedFile(null)}
                disabled={isUploading || isTranscribing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {isUploading && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Uploading...</span>
                  <span className="text-sm font-medium">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}
            
            {!isUploading && !transcriptionRecord && (
              <div className="mt-4">
                <Button 
                  type="submit"
                  disabled={!selectedFile || isUploading || isTranscribing || !user}
                  className="w-full"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading ({uploadProgress}%)
                    </>
                  ) : (
                    user ? 'Upload & Transcribe' : 'Sign in to Upload'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
        
        {transcriptionRecord && (
          <div className="border rounded-md p-4">
            <div className="flex items-center">
              <div className="mr-4">
                {transcriptionStatus === 'pending' && (
                  <Clock className="h-8 w-8 text-slate-400" />
                )}
                {transcriptionStatus === 'processing' && (
                  <div className="animate-spin">
                    <Loader2 className="h-8 w-8 text-blue-500" />
                  </div>
                )}
                {transcriptionStatus === 'completed' && (
                  <CheckCircle className="h-8 w-8 text-green-500" />
                )}
                {transcriptionStatus === 'error' && (
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">
                  {transcriptionStatus === 'pending' && 'Ready to transcribe'}
                  {transcriptionStatus === 'processing' && 'Transcribing...'}
                  {transcriptionStatus === 'completed' && 'Transcription complete'}
                  {transcriptionStatus === 'error' && 'Transcription failed'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {transcriptionStatus === 'pending' && 'Transcription will start shortly'}
                  {transcriptionStatus === 'processing' && 'This may take a minute or two'}
                  {transcriptionStatus === 'completed' && 'Your audio has been transcribed successfully'}
                  {transcriptionStatus === 'error' && transcriptionRecord.error}
                </p>
                
                {transcriptionStatus === 'completed' && transcriptionRecord.transcriptionText && (
                  <div className="mt-4 p-3 bg-slate-50 rounded border text-sm overflow-auto max-h-36">
                    {transcriptionRecord.transcriptionText.substring(0, 200)}
                    {transcriptionRecord.transcriptionText.length > 200 ? '...' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
} 
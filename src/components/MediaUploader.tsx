'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { 
  AlertCircle, 
  AlertTriangle, 
  Check, 
  FileText, 
  Loader2, 
  Sparkles, 
  TrendingUp,
  LineChart,
  Upload,
  AudioWaveform, 
  Video, 
  X, 
  FileAudio, 
  Clock, 
  CheckCircle 
} from 'lucide-react';
import useSupabase from '@/hooks/useSupabase';
import { 
  TranscriptionRecord, 
  uploadMediaFile,
  createTranscriptionRecord,
  mapDbRecordToTranscriptionRecord
} from '@/lib/media-storage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import Link from 'next/link';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';

export default function MediaUploader({ onComplete }: { onComplete?: (transcription: TranscriptionRecord) => void }) {
  const { supabase, user } = useSupabase();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transcriptionRecord, setTranscriptionRecord] = useState<TranscriptionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<'pending' | 'processing' | 'completed' | 'error'>('pending');
  const [analysisStatus, setAnalysisStatus] = useState<'pending' | 'processing' | 'completed' | 'error'>('pending');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTranscriptionId, setCurrentTranscriptionId] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string>('');

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement> | File[]) => {
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
    
    // Reset the transcription record when a new file is selected
    setTranscriptionRecord(null);
    setCurrentTranscriptionId(null);
    setUploadProgress(0);
    
    setSelectedFile(files[0]);
    setError(null);
  };

  const handleSubmit = async (event?: React.MouseEvent<HTMLButtonElement> | React.FormEvent) => {
    // Prevent any potential event bubbling
    if (event) {
      event.preventDefault();
    }
    
    // Debug log to track function calls
    console.log('handleSubmit called, current file:', selectedFile?.name);
    
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
        
        const transcriptionRecord = mapDbRecordToTranscriptionRecord(verifyRecord);
        setTranscriptionRecord(transcriptionRecord);
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
      
      // Store the transcription ID in a state variable for later use
      console.log('Setting current transcription ID:', transcriptionId);
      setCurrentTranscriptionId(transcriptionId);
      
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
      setTranscriptionRecord(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          summaryStatus: 'processing'
        };
      });
      
      console.log('Generating summary for transcription with ID:', transcriptionId);
      console.log('Using stored transcription ID:', currentTranscriptionId);
      
      // Use the stored ID if available, otherwise use the passed ID
      const finalTranscriptionId = currentTranscriptionId || transcriptionId;
      
      // Validate the transcription ID
      if (!finalTranscriptionId || typeof finalTranscriptionId !== 'string' || finalTranscriptionId.trim() === '') {
        console.error('Invalid transcription ID for summary:', finalTranscriptionId);
        throw new Error('Invalid transcription ID. Please try uploading again.');
      }
      
      // Verify the transcription exists in the database before making the API call
      console.log('Verifying transcription exists in database before summary API call...');
      const { data: existingRecord, error: recordError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', finalTranscriptionId)
        .single();
        
      if (recordError) {
        console.error('Error fetching transcription record for summary:', recordError);
        throw new Error(`Transcription record not found: ${recordError.message}`);
      }
      
      if (!existingRecord) {
        console.error('Transcription record not found for summary');
        throw new Error('The transcription record could not be found. Please try uploading again.');
      }
      
      console.log('Found transcription record for summary:', existingRecord);
      
      // Call the summary API
      console.log('Sending transcription to summary API...');
      
      // Get the session for authentication
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      
      if (!accessToken) {
        console.error('No access token available for API call');
        throw new Error('Authentication required. Please sign in and try again.');
      }
      
      console.log('Using access token for API authentication');
      
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          transcriptionId: finalTranscriptionId,
          transcriptionText: transcriptionText,
          accessToken: accessToken
        }),
        cache: 'no-store'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error || 'Failed to generate summary';
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('Summary generated successfully');
      
      // Verify that the database was updated correctly
      console.log('Verifying summary status in database...');
      const { data: verifyData, error: verifyError } = await supabase
        .from('transcriptions')
        .select('id, summary_status, summary_text')
        .eq('id', finalTranscriptionId)
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
            .eq('id', finalTranscriptionId);
            
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
      
      // After summary is complete, start analysis
      try {
        console.log('Starting automatic analysis...');
        await requestAnalysis(finalTranscriptionId);
      } catch (analysisError) {
        console.error('Failed to generate analysis:', analysisError);
        // Continue with the process even if analysis fails
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

  const requestAnalysis = async (transcriptionId: string) => {
    try {
      console.log('Starting analysis with transcription ID:', transcriptionId);
      console.log('Using stored transcription ID:', currentTranscriptionId);
      
      // Use the stored ID if available, otherwise use the passed ID
      const finalTranscriptionId = currentTranscriptionId || transcriptionId;
      
      if (!finalTranscriptionId || typeof finalTranscriptionId !== 'string' || finalTranscriptionId.trim() === '') {
        console.error('Invalid transcription ID:', finalTranscriptionId);
        throw new Error('Invalid transcription ID. Please try uploading again.');
      }
      
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(finalTranscriptionId.trim())) {
        console.error('Invalid UUID format for transcription ID:', finalTranscriptionId);
        throw new Error('Invalid transcription ID format. Please try uploading again.');
      }
      
      setIsAnalyzing(true);
      setAnalysisStatus('processing');
      
      console.log('Preparing to analyze transcription with ID:', finalTranscriptionId);
      
      // Verify the transcription exists in the database before making the API call
      console.log('Verifying transcription exists in database before API call...');
      const { data: existingRecord, error: recordError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', finalTranscriptionId)
        .single();
        
      if (recordError) {
        console.error('Error fetching transcription record:', recordError);
        console.error('Error code:', recordError.code);
        console.error('Error message:', recordError.message);
        console.error('Error details:', recordError.details);
        console.error('Transcription ID that failed:', finalTranscriptionId);
        
        // Try listing recent transcriptions to debug
        console.log('Listing recent transcriptions to debug...');
        const { data: recentTranscriptions } = await supabase
          .from('transcriptions')
          .select('id, created_at, status')
          .order('created_at', { ascending: false })
          .limit(5);
          
        console.log('Recent transcriptions:', recentTranscriptions);
        
        throw new Error(`Transcription record not found: ${recordError.message}`);
      }
      
      if (!existingRecord) {
        console.error('Transcription record not found, but no error returned');
        console.error('Transcription ID that failed:', finalTranscriptionId);
        throw new Error('The transcription record could not be found. Please try uploading again.');
      }
      
      console.log('Found transcription record:', existingRecord);
      console.log('Transcription text length:', existingRecord.transcription_text?.length || 0);
      
      // Ensure the transcription text exists - use snake_case field name from database
      if (!existingRecord.transcription_text) {
        console.error('Transcription text is empty for record:', existingRecord);
        throw new Error('The transcription text is empty. Please try uploading again.');
      }
      
      // Call the analysis API
      console.log('Sending transcription to analysis API...');
      console.log('Transcription ID being sent:', existingRecord.id); // Use ID directly from the database record
      console.log('Transcription record from database:', existingRecord);
      
      // Get the session for authentication
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      
      if (!accessToken) {
        console.error('No access token available for API call');
        throw new Error('Authentication required. Please sign in and try again.');
      }
      
      console.log('Using access token for API authentication');
      
      // Log the exact payload being sent to the API
      const payload = { 
        transcriptionId: existingRecord.id,
        // Include the transcription text as a backup in case the API can't find it in the database
        transcriptionText: existingRecord.transcription_text,
        accessToken: accessToken
      };
      console.log('API request payload:', JSON.stringify(payload));
      
      const response = await fetch('/api/analyze-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        // Add cache control to prevent caching
        cache: 'no-store'
      });
      
      // Log the response status
      console.log('Analysis API response status:', response.status);
      
      if (!response.ok) {
        let errorMessage = 'Failed to analyze transcript';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          console.error('Failed to parse error response:', e);
        }
        console.error('Analysis API error:', errorMessage);
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('Analysis generated successfully:', data);
      
      // Save the analysis data to Supabase
      if (data.analysis) {
        console.log('Saving analysis data to Supabase...');
        
        const { error: updateError } = await supabase
          .from('transcriptions')
          .update({
            analysis_status: 'completed',
            analysis_data: data.analysis,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRecord.id);
          
        if (updateError) {
          console.error('Error saving analysis data to Supabase:', updateError);
          // Continue anyway since we have the data in memory
        } else {
          console.log('Analysis data saved to Supabase successfully');
        }
      }
      
      // Update the transcription record with the analysis data
      // Map from snake_case database fields to camelCase for the UI
      if (transcriptionRecord) {
        // Fetch the latest record from the database to ensure we have the most up-to-date data
        const { data: updatedDbRecord, error: updateError } = await supabase
          .from('transcriptions')
          .select('*')
          .eq('id', finalTranscriptionId)
          .single();
          
        if (updateError) {
          console.error('Error fetching updated record:', updateError);
        } else if (updatedDbRecord) {
          console.log('Retrieved updated record after analysis:', updatedDbRecord);
          // Map the database record to our TypeScript interface
          const updatedRecord = mapDbRecordToTranscriptionRecord(updatedDbRecord);
          setTranscriptionRecord(updatedRecord);
        } else {
          // Fallback to just updating the analysis data if we can't get the full record
          setTranscriptionRecord({
            ...transcriptionRecord,
            analysisStatus: 'completed' as const,
            analysisData: data.analysis
          });
        }
      }
      
      setAnalysisStatus('completed');
      return data.analysis;
    } catch (err: any) {
      console.error('Analysis error:', err);
      setAnalysisStatus('error');
      if (transcriptionRecord) {
        setTranscriptionRecord({
          ...transcriptionRecord,
          analysisStatus: 'error' as const,
          error: err.message
        });
      }
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return <Badge variant="positive">Positive</Badge>;
      case 'negative':
        return <Badge variant="negative">Negative</Badge>;
      case 'neutral':
      default:
        return <Badge variant="neutral">Neutral</Badge>;
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
    
    if (isAnalyzing) {
      return (
        <div className="flex items-center gap-2 text-amber-500 p-3 bg-amber-50 rounded-md">
          <Loader2 size={18} className="animate-spin" />
          <p className="text-sm">Analyzing transcript for insights...</p>
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
            {transcriptionRecord.analysisStatus === 'completed' && ' Analysis complete.'}
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
            <TabsTrigger value="summary">
              <div className="flex items-center gap-2">
                <Sparkles size={16} />
                <span>AI Summary</span>
              </div>
            </TabsTrigger>
            <TabsTrigger value="sentiment">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} />
                <span>Sentiment Analysis</span>
              </div>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="summary" className="mt-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  AI-Generated Summary for {transcriptionRecord.fileName}
                </CardTitle>
                <CardDescription>Key insights from the audio recording</CardDescription>
              </CardHeader>
              <CardContent>
                {transcriptionRecord.summaryText ? (
                  <div className="p-4 bg-purple-50 rounded-md whitespace-pre-wrap prose max-w-none">
                    {transcriptionRecord.summaryText}
                  </div>
                ) : transcriptionRecord.summaryStatus === 'processing' ? (
                  <div className="flex items-center gap-2 p-4 bg-purple-50 rounded-md">
                    <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                    <p className="text-sm">Generating summary...</p>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-md">
                    <p className="text-sm text-gray-500">No summary available yet.</p>
                    <button 
                      onClick={handleSummarize}
                      className="mt-4 bg-primary text-white px-3 py-2 rounded-md text-sm flex items-center gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Generate Summary</span>
                    </button>
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground">
                <p>The summary is generated automatically using AI and may not capture all details.</p>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="sentiment" className="mt-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-amber-500" />
                  Sentiment Analysis for {transcriptionRecord.fileName}
                </CardTitle>
                <CardDescription>Customer sentiment insights from the interview</CardDescription>
              </CardHeader>
              <CardContent>
                {transcriptionRecord.analysisData ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium">Overall Sentiment:</h3>
                      <div className={`px-3 py-1 rounded-full text-white text-xs font-medium ${getSentimentColor(transcriptionRecord.analysisData.sentiment)}`}>
                        {transcriptionRecord.analysisData.sentiment.charAt(0).toUpperCase() + transcriptionRecord.analysisData.sentiment.slice(1)}
                      </div>
                    </div>
                    
                    <div className="mb-6 p-4 bg-yellow-50 rounded-md">
                      <h3 className="text-sm font-medium mb-2">Sentiment Explanation:</h3>
                      <p className="text-sm">{transcriptionRecord.analysisData.sentiment_explanation}</p>
                    </div>
                    
                    {transcriptionRecord.analysisData.pain_points && transcriptionRecord.analysisData.pain_points.length > 0 && (
                      <div className="mb-6">
                        <h3 className="text-sm font-medium mb-2">Pain Points:</h3>
                        <ul className="space-y-2">
                          {transcriptionRecord.analysisData.pain_points.map((point, index) => (
                            <li key={index} className="bg-gray-50 p-3 rounded-md">
                              <p className="text-sm font-medium">{point.issue}</p>
                              <p className="text-sm mt-1">{point.description}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {transcriptionRecord.analysisData.feature_requests && transcriptionRecord.analysisData.feature_requests.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium mb-2">Feature Requests:</h3>
                        <ul className="space-y-2">
                          {transcriptionRecord.analysisData.feature_requests.map((feature, index) => (
                            <li key={index} className="bg-gray-50 p-3 rounded-md">
                              <p className="text-sm font-medium">{feature.feature}</p>
                              <p className="text-sm mt-1">{feature.description}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : transcriptionRecord.analysisStatus === 'processing' ? (
                  <div className="flex items-center gap-2 p-4 bg-amber-50 rounded-md">
                    <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                    <p className="text-sm">Analyzing sentiment...</p>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-md">
                    <p className="text-sm text-gray-500">No sentiment analysis available yet.</p>
                    <button 
                      onClick={handleAnalyze}
                      className="mt-4 bg-primary text-white px-3 py-2 rounded-md text-sm flex items-center gap-2"
                    >
                      <LineChart className="h-4 w-4" />
                      <span>Analyze Sentiment</span>
                    </button>
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground">
                <p>Sentiment analysis is powered by AI and reflects the emotional tone detected in the interview.</p>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  };

  const handleSummarize = async () => {
    if (!transcriptionRecord?.id) return;
    
    try {
      setUpdateMessage('Starting summarization...');
      
      // Get the session for authentication
      const session = await supabase.auth.getSession();
      if (!session?.data?.session?.access_token) {
        setUpdateMessage('Authentication required. Please log in.');
        return;
      }
      
      // Call the summarize API route with the transcription record ID
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`
        },
        body: JSON.stringify({ transcriptionId: transcriptionRecord.id })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to summarize: ${error}`);
      }
      
      // Refresh the transcription record
      await refreshTranscriptionRecord();
      setUpdateMessage('Summary generated successfully!');
    } catch (error) {
      console.error('Error summarizing transcription:', error);
      setUpdateMessage(`Error: ${error instanceof Error ? error.message : 'Failed to summarize'}`);
    }
  };

  const handleAnalyze = async () => {
    if (!transcriptionRecord?.id) return;
    
    try {
      setUpdateMessage('Starting sentiment analysis...');
      
      // Get the session for authentication
      const session = await supabase.auth.getSession();
      if (!session?.data?.session?.access_token) {
        setUpdateMessage('Authentication required. Please log in.');
        return;
      }
      
      // Call the analyze API route with the transcription record ID
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`
        },
        body: JSON.stringify({ transcriptionId: transcriptionRecord.id })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to analyze: ${error}`);
      }
      
      // Refresh the transcription record
      await refreshTranscriptionRecord();
      setUpdateMessage('Sentiment analysis completed successfully!');
    } catch (error) {
      console.error('Error analyzing transcription:', error);
      setUpdateMessage(`Error: ${error instanceof Error ? error.message : 'Failed to analyze'}`);
    }
  };

  const getSentimentColor = (sentiment: string): string => {
    switch (sentiment.toLowerCase()) {
      case 'positive':
        return 'bg-green-500';
      case 'neutral':
        return 'bg-blue-500';
      case 'negative':
        return 'bg-red-500';
      case 'mixed':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  const refreshTranscriptionRecord = async () => {
    if (!transcriptionRecord?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', transcriptionRecord.id)
        .single();
      
      if (error) throw error;
      
      if (data) {
        const mappedRecord = mapDbRecordToTranscriptionRecord(data);
        setTranscriptionRecord(mappedRecord);
        
        // If completion callback is provided, call it with the updated record
        if (onComplete && mappedRecord.status === 'completed') {
          onComplete(mappedRecord);
        }
      }
    } catch (error) {
      console.error('Error refreshing transcription record:', error);
    }
  };

  // Cleanup function for component unmount
  useEffect(() => {
    // Return cleanup function to handle component unmounting
    return () => {
      // Cancel any in-progress operations if component unmounts
      setIsUploading(false);
      setIsTranscribing(false);
      setIsSummarizing(false);
      setIsAnalyzing(false);
    };
  }, []);

  useEffect(() => {
    if (currentTranscriptionId) {
      console.log('Polling for transcription updates with ID:', currentTranscriptionId);
      
      const fetchTranscriptionStatus = async () => {
        try {
          const { data, error } = await supabase
            .from('transcriptions')
            .select('*')
            .eq('id', currentTranscriptionId)
            .single();
            
          if (error) {
            console.error('Error fetching transcription status:', error);
            return;
          }
          
          if (data) {
            console.log('Fetched transcription data:', {
              id: data.id,
              status: data.status,
              summary_status: data.summary_status,
              analysis_status: data.analysis_status,
              has_summary: !!data.summary_text,
              has_analysis: !!data.analysis_data
            });
            
            // Map the database record to our interface format
            const mappedRecord = mapDbRecordToTranscriptionRecord(data);
            console.log('Mapped record:', {
              id: mappedRecord.id,
              summaryStatus: mappedRecord.summaryStatus,
              analysisStatus: mappedRecord.analysisStatus,
              hasSummary: !!mappedRecord.summaryText,
              hasAnalysis: !!mappedRecord.analysisData
            });
            
            setTranscriptionRecord(mappedRecord);
          }
        } catch (err) {
          console.error('Error in polling:', err);
        }
      };
      
      // Initial fetch
      fetchTranscriptionStatus();
      
      // Set up polling
      const intervalId = setInterval(fetchTranscriptionStatus, 5000);
      
      return () => clearInterval(intervalId);
    }
  }, [currentTranscriptionId, supabase]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">InsightAI - Customer Interview Analysis</h1>
      
      {/* Status banner */}
      {transcriptionRecord && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center text-green-700">
            <Check className="w-5 h-5 mr-2" />
            <span>
              <strong>{transcriptionRecord.fileName}</strong>: Transcription complete! 
              {transcriptionRecord.summaryStatus === 'completed' && ' Summary generated.'}
              {transcriptionRecord.analysisStatus === 'completed' && ' Analysis complete.'}
            </span>
          </div>
        </div>
      )}
      
      {/* Always visible file upload section */}
      <div className="space-y-4 mb-6 p-6 border border-gray-200 rounded-md bg-white shadow-sm">
        <div className="flex flex-col space-y-2">
          <label 
            htmlFor="file-input" 
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Upload audio or video file
          </label>
          <div className="flex flex-col space-y-2">
            <input
              id="file-input"
              type="file"
              accept="audio/*,video/*"
              disabled={isSubmitting}
              onChange={handleFilesSelected}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-sm text-gray-500">
              MP3 files up to 25MB
            </p>
          </div>
        </div>
        
        <div className="flex justify-end">
          <button 
            type="button" 
            disabled={isSubmitting || !selectedFile} 
            onClick={handleSubmit}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            <div>
              {isSubmitting ? (
                <div className="flex items-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <div>Processing...</div>
                </div>
              ) : (
                <div className="flex items-center">
                  <Upload className="mr-2 h-4 w-4" />
                  <div>Upload & Analyze</div>
                </div>
              )}
            </div>
          </button>
        </div>
        
        {uploadProgress > 0 && (
          <div className="w-full mt-4">
            <div className="flex justify-between text-xs mb-1">
              <span>Uploading...</span>
              <span>{uploadProgress.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full" 
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>
      
      {/* Tabs section */}
      {transcriptionRecord && renderTranscriptionContent()}
    </div>
  );
}
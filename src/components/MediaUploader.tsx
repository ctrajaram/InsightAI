'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { TranscriptChat } from './TranscriptChat';
import { updateAnalysisData, formatAnalysisDataForDb } from '@/utils/analysis';
import useSupabase from '@/hooks/useSupabase';
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
  CheckCircle,
  Bot,
  LogIn,
  Info,
  FileCheck,
  ListTodo,
  BarChart,
  BarChart2,
  FileQuestion,
  Heart,
  Badge,
  AlertOctagon,
  Lightbulb,
  CircleSlash,
  SmilePlus,
  Frown,
  CircleDot,
  Hash,
  KeyRound
} from 'lucide-react';
import { 
  TranscriptionRecord, 
  uploadMediaFile,
  createTranscriptionRecord,
  mapDbRecordToTranscriptionRecord,
  UploadedFileInfo
} from '@/lib/media-storage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';

export function MediaUploader({ onComplete }: { onComplete?: (transcription: TranscriptionRecord) => void }) {
  const { supabase, user } = useSupabase();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [transcriptionText, setTranscriptionText] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transcriptionRecord, setTranscriptionRecord] = useState<TranscriptionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'processing' | 'completed' | 'error' | 'waiting'>('idle');
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'processing' | 'completed' | 'error' | 'pending'>('idle');
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTranscriptionId, setCurrentTranscriptionId] = useState<string | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [loadingState, setLoadingState] = useState<'idle' | 'analyzing' | 'saving-analysis' | 'saving'>('idle');
  const [transcriptionData, setTranscriptionData] = useState<{
    transcription_text?: string;
    id?: string;
    status?: string;
    summary_status?: string;
    summary_text?: string;
  } | null>(null);

  // Use a ref to track which transcriptions we've already attempted to analyze
  const analysisAttempts = useRef<Set<string>>(new Set());

  // State for tracking summary request status
  const [summaryRequestInProgress, setSummaryRequestInProgress] = useState(false);
  const [lastSummaryRequestTime, setLastSummaryRequestTime] = useState<number>(0);
  const [summaryRequestCount, setSummaryRequestCount] = useState<number>(0);

  // Function to handle authentication and get a fresh token
  const getAuthToken = async (): Promise<string | null> => {
    try {
      // Get a fresh session token for authentication
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !sessionData?.session) {
        console.error('Session error:', sessionError);
        return null;
      }
      
      return sessionData.session.access_token;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  };
  
  // Function to refresh the session when authentication errors occur
  const refreshSession = async (): Promise<boolean> => {
    console.log('Attempting to refresh session...');
    try {
      // First try refreshing the session
      const { data, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error('Failed to refresh session:', error);
        // If we can't refresh, show a message to the user
        setErrorMessage('Your session has expired. Please sign in again to continue.');
        return false;
      }
      
      if (data.session) {
        console.log('Session refreshed successfully');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error during session refresh:', error);
      setErrorMessage('Authentication error. Please sign in again to continue.');
      return false;
    }
  };

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
      let fileInfo;
      
      // Try to refresh the session first to ensure we have a valid token
      await refreshSession();
      
      // Use direct upload method from our library
      try {
        fileInfo = await uploadMediaFile(selectedFile, user.id);
        console.log('File uploaded successfully:', fileInfo);
      } catch (uploadError: any) {
        console.error('Upload error:', uploadError);
        
        // Check for authentication errors
        if (uploadError.message.includes('auth') || 
            uploadError.message.includes('permission') || 
            uploadError.message.includes('policy')) {
          
          // Try refreshing the session and uploading again
          console.log('Authentication error detected, refreshing session...');
          const refreshed = await refreshSession();
          
          if (refreshed) {
            console.log('Session refreshed, retrying upload...');
            // Get the fresh session
            const { data: { session: freshSession } } = await supabase.auth.getSession();
            
            if (freshSession && freshSession.access_token) {
              // Retry the upload with the new token
              fileInfo = await uploadMediaFile(selectedFile, user.id);
            } else {
              setError('Authentication error: Please sign in again and try once more.');
              clearInterval(progressInterval);
              setIsUploading(false);
              setIsSubmitting(false);
              return;
            }
          } else {
            setError('Authentication error: Please sign in again and try once more.');
            clearInterval(progressInterval);
            setIsUploading(false);
            setIsSubmitting(false);
            return;
          }
        } else {
          // Re-throw other errors
          throw uploadError;
        }
      }
      
      console.log('File uploaded successfully, creating record...');
      
      // Create transcription record in database
      try {
        const record = await createTranscriptionRecord(fileInfo as UploadedFileInfo, user.id);
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
    if (!transcriptionId || !mediaUrl) {
      console.error('Missing required parameters for transcription:', { transcriptionId, mediaUrl });
      setError('Missing required parameters for transcription. Please try again.');
      return;
    }
    
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
      
      console.log('Found transcription record for API call:', existingRecord);
      
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
        // Clone the response so we can read it multiple times if needed
        const responseClone = response.clone();
        
        let errorData: { error: string; details: string | null } = { 
          error: 'Unknown error', 
          details: null 
        };
        
        try {
          errorData = await response.json();
        } catch (jsonError: any) {
          try {
            const responseText = await responseClone.text();
            console.error('Raw error response:', responseText.substring(0, 200)); // Log first 200 chars
            errorData = {
              error: 'Server error',
              details: responseText.substring(0, 100)
            };
          } catch (textError) {
            console.error('Failed to read error response:', textError);
          }
        }
        
        const errorMessage = errorData.error || 'Failed to transcribe media';
        
        // Check for OpenAI API key errors
        if (errorMessage.includes('OpenAI API key') || errorMessage.includes('API key')) {
          throw new Error('OpenAI API key is missing or invalid. Please visit /api-setup to configure your API key.');
        }
        
        // Check for authorization errors
        if (response.status === 401) {
          throw new Error('You must be logged in to transcribe media. Please sign in and try again.');
        }
        
        // Check for timeout errors
        if (response.status === 504 || errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
          throw new Error('The transcription process timed out. Your file may be too large or the server is busy. Please try again later or use a smaller file.');
        }
        
        // Check for authentication errors and attempt to refresh the session
        if (response.status === 401 || (errorData.error && errorData.error.includes('Authentication failed'))) {
          console.log('Authentication error detected, attempting to refresh session...');
          const refreshed = await refreshSession();
          
          if (refreshed) {
            console.log('Session refreshed, retrying transcription...');
            // Get the fresh session
            const { data: { session: freshSession } } = await supabase.auth.getSession();
            
            if (freshSession && freshSession.access_token) {
              // Retry the transcription with the new token
              const retryResponse = await fetch('/api/transcribe', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                  transcriptionId,
                  mediaUrl,
                  accessToken: freshSession.access_token,
                  record: existingRecord
                }),
              });
              
              if (retryResponse.ok) {
                // If retry succeeded, continue with the new response
                const retryData = await retryResponse.json();
                console.log('Retry successful:', retryData);
                
                // Continue with the successful response
                const isPartial = retryData.isPartial || false;
                setTranscriptionStatus(isPartial ? 'processing' : 'completed');
                
                // Update the transcription record with the new transcript text
                // Handle both snake_case and camelCase field names
                const transcriptionText = retryData.transcriptionText || retryData.text || '';
                
                // Map the database record to our client interface
                const updatedRecord = mapDbRecordToTranscriptionRecord({
                  ...existingRecord,
                  transcription_text: transcriptionText,
                  status: isPartial ? 'processing' : 'completed',
                });
                
                setTranscriptionRecord(updatedRecord);
                return;
              } else {
                // If retry failed, continue with original error handling
                console.error('Retry after session refresh failed');
              }
            }
          } else {
            console.error('Failed to refresh session');
            setError('Your session has expired. Please sign out and sign back in to continue.');
            setTranscriptionStatus('error');
            return;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Clone the response so we can read it multiple times if needed
      const responseClone = response.clone();
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError: any) {
        console.error('Failed to parse successful response as JSON');
        try {
          const responseText = await responseClone.text();
          console.error('Raw response:', responseText.substring(0, 200)); // Log first 200 chars
          throw new Error('Invalid response from server. Please try again.');
        } catch (textError) {
          console.error('Could not read response body');
          throw new Error('Invalid response from server. Please try again.');
        }
      }
      
      // Verify that the database was updated correctly
      console.log('Verifying transcription status in database...');
      const { data: verifyData, error: verifyError } = await supabase
        .from('transcriptions')
        .select('id, status')
        .eq('id', transcriptionId)
        .single();
        
      if (verifyError) {
        console.error('Failed to verify transcription status:', verifyError);
      } else {
        console.log('Verified transcription record:', verifyData);
        
        // If the status is still "processing", try to update it directly
        if (verifyData.status === 'processing' && (data.text || data.transcriptionText)) {
          console.log('Status still showing processing, attempting direct update...');
          
          // Get the transcription text from either field format
          const transcriptionText = data.transcriptionText || data.text || '';
          
          const { error: updateError } = await supabase
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: transcriptionText,
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
      
      // Update transcription status appropriately
      setTranscriptionStatus(data.isPartial ? 'processing' : 'completed');
      
      // Update the transcription record with the new transcript text
      const updatedRecord: TranscriptionRecord = {
        ...transcriptionRecord!,
        transcriptionText: data.transcriptionText || data.text || '',
        status: data.isPartial ? 'partial' : 'completed',
      };
      
      setTranscriptionRecord(updatedRecord);
      
      if (data.isPartial) {
        console.log('Received partial transcription for large file');
        setUploadMessage('Large file detected. A partial transcription has been generated while the full version is being processed in the background.');
        
        // Set up a polling mechanism to check for the full transcription
        const pollInterval = setInterval(async () => {
          console.log('Polling for completed transcription...');
          const { data: pollData, error: pollError } = await supabase
            .from('transcriptions')
            .select('id, status, transcription_text, rev_ai_job_id, error')
            .eq('id', transcriptionId)
            .single();
            
          if (pollError) {
            console.error('Error polling for transcription:', pollError);
            return;
          }
          
          // Check if there's an error status
          if (pollData.status === 'error') {
            console.error('Transcription failed with error:', pollData.error);
            clearInterval(pollInterval);
            setTranscriptionStatus('error');
            setError(`Transcription failed: ${pollData.error || 'Unknown error'}`);
            return;
          }
          
          if (pollData.status === 'completed') {
            console.log('Full transcription now available:', pollData);
            clearInterval(pollInterval);
            
            // Update the UI with the complete transcription
            setTranscriptionStatus('completed');
            
            // Create a stable copy of the transcription data to use throughout the process
            const completedTranscription = {
              ...transcriptionRecord!,
              transcriptionText: pollData.transcription_text || '',
              status: 'completed' as const,
            };
            
            // Update the UI state first
            setTranscriptionRecord(completedTranscription);
            
            // Wait a moment for the UI to stabilize before starting additional processing
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Start summarization and analysis with the complete transcription
            try {
              console.log('Starting automatic summarization...');
              await generateSummaryForTranscription(transcriptionId, completedTranscription.transcriptionText);
              
              // After summary is complete, automatically start analysis
              try {
                console.log('Starting automatic analysis...');
                await requestAnalysis(transcriptionId);
              } catch (analysisError) {
                console.error('Failed to generate analysis:', analysisError);
              }
            } catch (summaryError) {
              console.error('Failed to generate summary:', summaryError);
              
              // Try to start analysis anyway, even if summary failed
              try {
                console.log('Starting analysis despite summary failure...');
                await requestAnalysis(transcriptionId);
              } catch (analysisError) {
                console.error('Failed to generate analysis after summary failure:', analysisError);
              }
            }
          }
        }, 10000); // Poll every 10 seconds
        
        // Stop polling after 5 minutes (30 polls)
        setTimeout(() => {
          clearInterval(pollInterval);
          console.log('Stopped polling for transcription after timeout');
        }, 300000);
      } else {
        console.log('Transcription completed successfully');
        
        // Automatically start the summarization process
        console.log('Starting automatic summarization...');
        try {
          await generateSummaryForTranscription(transcriptionId, data.transcriptionText || '');
          
          // After summary is complete, automatically start analysis
          try {
            console.log('Starting automatic analysis...');
            await requestAnalysis(transcriptionId);
          } catch (analysisError) {
            console.error('Failed to generate analysis:', analysisError);
          }
        } catch (summaryError) {
          console.error('Failed to generate summary:', summaryError);
          // Continue with the process even if summarization fails
          
          // Try to start analysis anyway, even if summary failed
          try {
            console.log('Starting analysis despite summary failure...');
            await requestAnalysis(transcriptionId);
          } catch (analysisError) {
            console.error('Failed to generate analysis after summary failure:', analysisError);
          }
        }
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

  const handleTranscriptionComplete = async (record: TranscriptionRecord) => {
    console.log('Transcription completed:', record);
    setTranscriptionStatus('completed');
    setIsTranscribing(false);
    setTranscriptionRecord(record);
    
    // Wait a short delay to ensure the transcription is fully saved
    setTimeout(async () => {
      try {
        // Fetch the latest transcription record to ensure we have the most up-to-date data
        const { data: latestRecord, error: fetchError } = await supabase
          .from('transcriptions')
          .select('*')
          .eq('id', record.id)
          .single();
        
        if (fetchError) {
          console.error('Error fetching latest transcription record:', fetchError);
          return;
        }
        
        if (!latestRecord) {
          console.error('No transcription record found after completion');
          return;
        }
        
        // Check if the transcription text appears to be a processing message
        const processingPhrases = [
          'processing your audio',
          'processing audio file',
          'being processed',
          'may take several minutes',
          'using rev.ai',
          'transcription in progress'
        ];
        
        const isProcessingMessage = processingPhrases.some(phrase => 
          latestRecord.transcription_text?.toLowerCase().includes(phrase.toLowerCase())
        ) || !latestRecord.transcription_text || latestRecord.transcription_text.length < 50;
        
        if (isProcessingMessage) {
          console.log('Detected processing message in transcription, delaying summary generation');
          setErrorMessage('Waiting for complete transcription before generating summary');
          
          // Set up a polling mechanism to check for complete transcription
          const pollInterval = setInterval(async () => {
            const { data: updatedRecord, error: pollError } = await supabase
              .from('transcriptions')
              .select('*')
              .eq('id', record.id)
              .single();
              
            if (!pollError && updatedRecord && 
                updatedRecord.transcription_text && 
                updatedRecord.transcription_text.length > 100 &&
                !processingPhrases.some(phrase => 
                  updatedRecord.transcription_text?.toLowerCase().includes(phrase.toLowerCase())
                )) {
              clearInterval(pollInterval);
              console.log('Found complete transcription text, generating summary');
              generateSummaryForTranscription(updatedRecord.id, updatedRecord.transcription_text);
            }
          }, 5000); // Poll every 5 seconds
          
          // Stop polling after 2 minutes
          setTimeout(() => {
            clearInterval(pollInterval);
            console.log('Stopped polling for complete transcription after timeout');
          }, 120000);
          
          return;
        }
        
        // If we have valid transcription text, generate a summary
        if (latestRecord.transcription_text && latestRecord.transcription_text.trim().length > 0) {
          console.log('Starting automatic summary generation');
          generateSummaryForTranscription(latestRecord.id, latestRecord.transcription_text);
        }
      } catch (error) {
        console.error('Error in handleTranscriptionComplete:', error);
      }
    }, 1000);
  };

  const generateSummaryForTranscription = async (finalTranscriptionId: string, finalTranscriptionText: string) => {
    console.log(`Processing summary for transcription ID: ${finalTranscriptionId}`);
    
    // Implement debouncing to prevent multiple rapid requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastSummaryRequestTime;
    
    // If a summary request is already in progress, don't start another one
    if (summaryRequestInProgress) {
      console.log('Summary request already in progress, skipping duplicate request');
      return;
    }
    
    // If we've made a request in the last 5 seconds, wait before making another one
    if (timeSinceLastRequest < 5000) {
      console.log(`Last summary request was ${timeSinceLastRequest}ms ago, debouncing`);
      setErrorMessage('Please wait a moment before requesting another summary');
      return;
    }
    
    // Validate inputs before proceeding
    if (!finalTranscriptionId) {
      console.error('Missing transcription ID, cannot generate summary');
      setErrorMessage('Cannot generate summary: Missing transcription ID');
      return;
    }
    
    if (!finalTranscriptionText || finalTranscriptionText.trim().length < 10) {
      console.error('Transcription text is too short or empty, cannot generate summary');
      setErrorMessage('Cannot generate summary: Transcription text is too short or empty');
      return;
    }
    
    // Update state to track this request
    setSummaryRequestInProgress(true);
    setLastSummaryRequestTime(now);
    setSummaryRequestCount(prev => prev + 1);
    
    try {
      // Update state to show we're generating a summary
      setIsSummarizing(true);
      setSummaryStatus('processing');
      setErrorMessage(null); // Clear any previous error messages
      
      // Get the access token
      const { data: { session } } = await supabase.auth.getSession();
      let accessToken = session?.access_token;
      
      // Try to refresh the session first to ensure we have a valid token
      try {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.warn('Session refresh warning (continuing anyway):', refreshError);
        } else {
          console.log('Session refreshed successfully before summary request');
          // Get the fresh token
          const { data: { session: refreshedSession } } = await supabase.auth.getSession();
          
          if (refreshedSession?.access_token) {
            accessToken = refreshedSession.access_token;
          }
        }
      } catch (refreshError) {
        console.warn('Error refreshing session (continuing anyway):', refreshError);
      }
      
      // Prepare the request payload AFTER refreshing the session
      const payload = {
        transcriptionId: finalTranscriptionId,
        transcriptionText: finalTranscriptionText || '',
        accessToken: accessToken || ''
      };
      
      // Validate the payload
      if (!payload.transcriptionId) {
        throw new Error('Missing transcriptionId in payload');
      }
      
      if (!payload.transcriptionText || typeof payload.transcriptionText !== 'string') {
        console.warn('Empty or invalid transcriptionText in payload, setting to empty string');
        payload.transcriptionText = '';
      }
      
      console.log('Sending summary request with payload:', {
        transcriptionId: payload.transcriptionId,
        textLength: payload.transcriptionText?.length || 0,
        hasAccessToken: !!payload.accessToken
      });
      
      // Ensure the request body is valid JSON
      let requestBody: string;
      try {
        requestBody = JSON.stringify(payload);
        // Test parse to ensure it's valid JSON
        JSON.parse(requestBody);
        console.log('Request body is valid JSON, length:', requestBody.length);
      } catch (jsonError: any) {
        console.error('Failed to create valid JSON payload:', jsonError);
        throw new Error('Failed to create valid JSON payload: ' + (jsonError.message || 'Unknown error'));
      }
      
      // Double-check that we have a valid request body
      if (!requestBody || requestBody === '{}' || requestBody.length < 10) {
        throw new Error('Invalid request body: empty or too short');
      }
      
      // Make the API call to generate the summary with retry logic
      let retryCount = 0;
      const maxRetries = 3;
      let response: Response | null = null;
      
      while (retryCount <= maxRetries) {
        try {
          console.log(`Attempt ${retryCount + 1}/${maxRetries + 1} to send fetch request to /api/summarize`);
          
          // Use XMLHttpRequest instead of fetch for more control, but make it asynchronous
          response = await new Promise<Response>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Set up event handlers
            xhr.onload = function() {
              console.log(`XHR response status: ${xhr.status}, statusText: ${xhr.statusText}`);
              console.log('XHR response headers:', xhr.getAllResponseHeaders());
              
              // Create a Response object from the XHR response
              const responseBody = xhr.responseText;
              console.log('XHR response body (first 100 chars):', responseBody.substring(0, 100));
              
              const response = new Response(responseBody, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: new Headers({
                  'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json'
                })
              });
              
              resolve(response);
            };
            
            xhr.onerror = function() {
              console.error('XHR network error');
              reject(new Error('Network error during summary request'));
            };
            
            xhr.ontimeout = function() {
              console.error('XHR request timed out');
              reject(new Error('Request timed out'));
            };
            
            // Open and send the request
            xhr.open('POST', '/api/summarize', true); // Asynchronous request
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (accessToken) {
              xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            }
            
            // Log the exact request body being sent
            console.log('Sending exact request body:', requestBody);
            
            // Send the request
            xhr.send(requestBody);
          });
          
          // Check if we need to handle authentication errors
          if (response && response.status === 401) {
            console.log('Received 401 error, attempting to refresh token');
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError) {
              const { data: { session: freshSession } } = await supabase.auth.getSession();
              
              if (freshSession && freshSession.access_token) {
                accessToken = freshSession.access_token;
                payload.accessToken = accessToken;
                requestBody = JSON.stringify(payload);
                console.log('Token refreshed, retrying with new token');
                retryCount++;
                continue;
              }
            }
          }
          
          // If we got a successful response or a non-auth error, break out of the retry loop
          if (response && (response.status >= 200 && response.status < 300 || response.status !== 401)) {
            break;
          }
        } catch (fetchError: any) {
          console.error(`Fetch error in summary request (attempt ${retryCount + 1}):`, fetchError);
          retryCount++;
          
          if (retryCount <= maxRetries) {
            // Wait before retrying (exponential backoff)
            const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
            console.log(`Retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            throw new Error(`Network error during summary request after ${maxRetries} retries: ${fetchError.message || 'Unknown error'}`);
          }
        }
      }
      
      if (!response) {
        throw new Error('Failed to get response from summary API after multiple attempts');
      }
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        console.error(`Error response from summary API: ${response.status} ${response.statusText}`);
        
        try {
          const errorData = await response.json();
          console.error('Error data:', errorData);
          
          // Check for rate limit errors
          if (response.status === 429 || (errorData.error && errorData.error.includes('rate limit'))) {
            console.log('Rate limit reached, will retry in 10 seconds');
            setErrorMessage('OpenAI rate limit reached. Retrying in 10 seconds...');
            
            // Keep the summarizing state but update UI to show waiting
            setSummaryStatus('waiting');
            
            // Set a timeout to retry after 10 seconds
            setTimeout(() => {
              console.log('Retrying summary generation after rate limit cooldown');
              setSummaryRequestInProgress(false);
              generateSummaryForTranscription(finalTranscriptionId, finalTranscriptionText);
            }, 10000);
            
            return;
          }
          
          // Check if we already have a summary (this is not an error)
          if (errorData.message && errorData.message.includes('Summary already exists')) {
            console.log('Summary already exists, using existing summary');
            setErrorMessage(null);
            setIsSummarizing(false);
            setSummaryStatus('completed');
            setSummaryRequestInProgress(false);
            
            // Fetch the latest record to get the summary
            const { data: latestRecord, error: fetchError } = await supabase
              .from('transcriptions')
              .select('id, user_id, transcription_text, summary_status, summary_text, analysis_status, analysis_data, status, created_at, media_path, media_url')
              .eq('id', finalTranscriptionId)
              .single();
              
            if (!fetchError && latestRecord) {
              // Update the record with the existing summary
              setTranscriptionRecord(mapDbRecordToTranscriptionRecord(latestRecord));
            }
            
            return;
          }
          
          // Check if this is an authentication error
          const isAuthError = response.status === 401 || 
                           errorData.error?.toLowerCase().includes('auth') || 
                           errorData.error?.toLowerCase().includes('token') || 
                           errorData.error?.toLowerCase().includes('permission');
          
          if (isAuthError) {
            setErrorMessage('Authentication error: Please refresh the page and try again');
          } else {
            setErrorMessage(errorData.error || 'Failed to generate summary');
          }
        } catch (parseError: any) {
          try {
            // If JSON parsing fails, try to get the response as text
            const errorText = await responseClone.text();
            console.error('Raw error response:', errorText);
            
            // Check for rate limit errors in the text
            if (errorText.includes('rate limit') || errorText.includes('429')) {
              console.log('Rate limit reached, will retry in 10 seconds');
              setErrorMessage('OpenAI rate limit reached. Retrying in 10 seconds...');
              
              // Keep the summarizing state but update UI to show waiting
              setSummaryStatus('waiting');
              
              // Set a timeout to retry after 10 seconds
              setTimeout(() => {
                console.log('Retrying summary generation after rate limit cooldown');
                setSummaryRequestInProgress(false);
                generateSummaryForTranscription(finalTranscriptionId, finalTranscriptionText);
              }, 10000);
              
              return;
            }
            
            setErrorMessage(errorText || 'Failed to generate summary');
          } catch (textError) {
            // If all else fails, use the status text
            setErrorMessage(`Error ${response.status}: ${response.statusText || 'Unknown error'}`);
          }
        }
        
        // Set error state and stop processing
        setIsSummarizing(false);
        setSummaryStatus('error');
        setSummaryRequestInProgress(false);
        return;
      }
      
      // Parse the successful response
      let data;
      try {
        data = await response.json();
        console.log('Summary response parsed successfully:', data);
      } catch (jsonError: any) {
        console.error('Failed to parse summary response as JSON:', jsonError);
        try {
          const responseText = await responseClone.text();
          console.error('Raw response:', responseText.substring(0, 200)); // Log first 200 chars
          throw new Error('Invalid response from server. Please try again.');
        } catch (textError) {
          console.error('Could not read response body');
          throw new Error('Invalid response from server. Please try again.');
        }
      }
      
      console.log('Summary generated successfully:', data);
      
      // Check if this is a placeholder summary
      const isPlaceholder = data.isPlaceholder === true;
      if (isPlaceholder) {
        console.log('Received placeholder summary. Will enable summary tab but show placeholder message.');
      }
      
      // Check if the summary was saved to the database
      if (data.dbUpdateSuccess === false) {
        console.warn('Summary was generated but not saved to the database. Attempting to save it manually...');
        
        // Try to manually update the database with the summary
        try {
          const { error: manualUpdateError } = await supabase
            .from('transcriptions')
            .update({
              summary_text: data.summary.text,
              summary_status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', finalTranscriptionId);
            
          if (manualUpdateError) {
            console.error('Manual update of summary failed:', manualUpdateError);
          } else {
            console.log('Manual update of summary succeeded');
          }
        } catch (manualError) {
          console.error('Error during manual summary update:', manualError);
        }
      }
      
      // Verify that the database was updated correctly
      const { data: updatedRecord, error: fetchError } = await supabase
        .from('transcriptions')
        .select('id, analysis_data, analysis_status, transcription_text, status, created_at, media_path, media_url, user_id, summary_text, summary_status')
        .eq('id', finalTranscriptionId)
        .single();
      
      if (fetchError) {
        console.error('Error verifying summary update:', fetchError);
        setErrorMessage('Error verifying summary update');
      } else {
        console.log('Verified summary update. Summary status:', updatedRecord.summary_status);
        console.log('Summary text present:', !!updatedRecord.summary_text);
        console.log('Summary text:', updatedRecord.summary_text?.substring(0, 100));
        
        // If the summary text is missing in the database but we have it in the response, use it directly
        const summaryTextToUse = updatedRecord.summary_text || (data.summary && data.summary.text) || '';
        
        if (!updatedRecord.summary_text && data.summary && data.summary.text) {
          console.log('Summary text missing in database but available in response. Using response data.');
          
          // Try to update the database one more time
          try {
            const { error: finalUpdateError } = await supabase
              .from('transcriptions')
              .update({
                summary_text: data.summary.text,
                summary_status: 'completed',
                updated_at: new Date().toISOString()
              })
              .eq('id', finalTranscriptionId);
              
            if (finalUpdateError) {
              console.error('Final attempt to update summary failed:', finalUpdateError);
            } else {
              console.log('Final summary update succeeded');
            }
          } catch (finalError) {
            console.error('Error during final summary update:', finalError);
          }
        }
        
        // Map the database record to our frontend format
        const mappedRecord = mapDbRecordToTranscriptionRecord(updatedRecord);
        console.log('Mapped record summary text present:', !!mappedRecord.summaryText);
        console.log('Mapped record summary text:', mappedRecord.summaryText?.substring(0, 100));
        
        // Update the transcription record in state, ensuring the summary text is set
        setTranscriptionRecord(prev => {
          if (!prev) return null;
          
          // If we have a placeholder summary, make sure it's marked as such
          const finalSummaryText = mappedRecord.summaryText || summaryTextToUse;
          const finalSummaryStatus = isPlaceholder ? 'completed' : (mappedRecord.summaryStatus || 'completed');
          
          // Ensure summary text is properly set
          return {
            ...mappedRecord,
            summaryText: finalSummaryText,
            summaryStatus: finalSummaryStatus,
            isPlaceholderSummary: isPlaceholder || false
          };
        });
      }
      
      // Update state to show we've completed generating a summary
      setIsSummarizing(false);
      setSummaryStatus('completed');
      setErrorMessage(null);
      
      // After summary is complete, automatically trigger analysis
      if (data.success && finalTranscriptionId) {
        console.log('Summary complete, automatically starting analysis');
        setTimeout(() => {
          requestAnalysis(finalTranscriptionId);
        }, 1000);
      }
      
    } catch (error: any) {
      console.error('Error generating summary:', error);
      setIsSummarizing(false);
      setSummaryStatus('error');
      setErrorMessage('Failed to generate summary: ' + (error.message || 'Unknown error'));
    } finally {
      // Always reset the request in progress flag when done
      setSummaryRequestInProgress(false);
    }
  };

  const retryOperation = async <T,>(
    operation: () => Promise<T>,
    maxRetries = 3,
    initialDelay = 1000,
    label = 'Operation'
  ): Promise<T> => {
    let lastError;
    let delay = initialDelay;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        console.log(`${label} attempt ${attempt} failed, retrying in ${delay}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Exponential backoff
      }
    }
    
    console.error(`${label} failed after ${maxRetries} attempts`);
    throw lastError;
  };

  const requestAnalysis = async (transcriptionId: string) => {
    console.log(`Requesting analysis for transcription ID: ${transcriptionId}`);
    
    // Prevent duplicate or rapid requests
    if (analysisStatus === 'processing' || analysisStatus === 'pending') {
      console.log('Analysis request already in progress, skipping duplicate request');
      return;
    }
    
    // Validate transcription ID
    if (!transcriptionId) {
      console.error('Invalid transcription ID for analysis');
      setErrorMessage('Cannot analyze: Missing transcription ID');
      return;
    }
    
    try {
      // Update state to show we're generating an analysis - do this FIRST to prevent flickering
      setIsAnalyzing(true);
      setAnalysisStatus('processing');
      setErrorMessage(null); // Clear any previous error messages
      
      // Add a small delay to let the UI stabilize before making API calls
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // First, check if the transcription is complete
      const { data: transcription, error: transcriptionError } = await supabase
        .from('transcriptions')
        .select('id, status, transcription_text')
        .eq('id', transcriptionId)
        .single();
        
      if (transcriptionError) {
        console.error('Error fetching transcription status:', transcriptionError);
        throw new Error('Failed to verify transcription status');
      }
      
      if (!transcription) {
        console.error('Transcription not found');
        throw new Error('Transcription not found');
      }
      
      // Check if transcription is complete
      if (transcription.status !== 'completed') {
        console.log('Transcription is not complete yet, cannot analyze');
        setAnalysisStatus('pending');
        setErrorMessage('Waiting for transcription to complete before analysis');
        
        // Return early, analysis will be triggered after transcription completes
        return;
      }
      
      // Get the access token
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch (error) {
        console.error('Failed to get access token:', error);
      }
      
      // Prepare request payload
      const payload = {
        transcriptionId,
        accessToken
      };
      
      // Validate payload before sending
      if (!payload.transcriptionId) {
        throw new Error('Missing transcription ID in payload');
      }
      
      const payloadString = JSON.stringify(payload);
      console.log('Sending analysis request with payload:', payloadString.substring(0, 100) + (payloadString.length > 100 ? '...' : ''));
      
      // Make the API call to generate the analysis
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: payloadString
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        console.error(`Error response from analysis API: ${response.status} ${response.statusText}`);
        
        // Special handling for 202 Accepted status (transcription still processing)
        if (response.status === 202) {
          try {
            const errorData = await response.json();
            console.log('Transcription still processing:', errorData);
            
            // Set analysis status to pending
            setAnalysisStatus('pending');
            setErrorMessage('Waiting for transcription to complete before analysis');
            
            // If we have a retry suggestion, schedule a retry
            if (errorData.retryAfter && typeof errorData.retryAfter === 'number') {
              const retrySeconds = Math.max(5, Math.min(30, errorData.retryAfter)); // Between 5-30 seconds
              console.log(`Will retry analysis in ${retrySeconds} seconds`);
              
              // Schedule retry
              setTimeout(() => {
                console.log('Retrying analysis after waiting period');
                requestAnalysis(transcriptionId);
              }, retrySeconds * 1000);
            }
            
            // Update the UI to show that analysis is pending
            setTranscriptionRecord(prev => {
              if (!prev) return null;
              // Make sure to use a valid analysisStatus value
              return {
                ...prev,
                analysisStatus: 'pending'
              };
            });
            
            return; // Exit early, we're handling this case specially
          } catch (parseError) {
            console.error('Failed to parse 202 response:', parseError);
          }
        }
        
        // Check if we need to handle authentication errors
        if (response.status === 401) {
          console.log('Received 401 error, attempting to refresh token');
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError) {
            const { data: { session: freshSession } } = await supabase.auth.getSession();
            
            if (freshSession && freshSession.access_token) {
              const newAccessToken = freshSession.access_token;
              
              // Prepare retry payload
              const retryPayload = {
                transcriptionId,
                accessToken: newAccessToken
              };
              
              // Log the retry payload
              const retryPayloadString = JSON.stringify(retryPayload);
              console.log('Retrying with new token. Payload:', retryPayloadString.substring(0, 100) + (retryPayloadString.length > 100 ? '...' : ''));
              
              // Retry the request with the new token
              const retryResponse = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${newAccessToken}`
                },
                body: retryPayloadString
              });
              
              if (retryResponse.ok) {
                // If retry succeeded, process the response
                const retryData = await retryResponse.json();
                console.log('Retry successful:', retryData);
                
                // Update the UI with the analysis results
                if (retryData.success) {
                  setIsAnalyzing(false);
                  setAnalysisStatus('completed');
                  setErrorMessage(null);
                  
                  // Update the transcription record with the analysis data
                  setTranscriptionRecord(prev => {
                    if (!prev) return null;
                    return {
                      ...prev,
                      analysisData: retryData.analysisData || prev.analysisData,
                      analysisStatus: 'completed'
                    };
                  });
                }
                
                return;
              } else {
                // If retry failed, continue with original error handling
                console.error('Retry after session refresh failed');
              }
            }
          }
        }
        
        try {
          const errorData = await response.json();
          console.error('Error data:', errorData);
          
          // Check for rate limit errors
          if (response.status === 429 || (errorData.error && errorData.error.includes('rate limit'))) {
            console.log('Rate limit reached, will retry in 10 seconds');
            setErrorMessage('OpenAI rate limit reached. Retrying in 10 seconds...');
            
            // Keep the analyzing state but update UI to show pending
            setAnalysisStatus('pending');
            
            // Set a timeout to retry after 10 seconds
            setTimeout(() => {
              console.log('Retrying analysis generation after rate limit cooldown');
              requestAnalysis(transcriptionId);
            }, 10000);
            
            return;
          }
          
          setErrorMessage(errorData.error || 'Failed to generate analysis');
        } catch (parseError: any) {
          try {
            // If JSON parsing fails, try to get the response as text
            const errorText = await responseClone.text();
            console.error('Error response text:', errorText);
            
            // Check for rate limit errors in the text
            if (errorText.includes('rate limit') || errorText.includes('429')) {
              console.log('Rate limit reached, will retry in 10 seconds');
              setErrorMessage('OpenAI rate limit reached. Retrying in 10 seconds...');
              
              // Keep the analyzing state but update UI to show pending
              setAnalysisStatus('pending');
              
              // Set a timeout to retry after 10 seconds
              setTimeout(() => {
                console.log('Retrying analysis generation after rate limit cooldown');
                requestAnalysis(transcriptionId);
              }, 10000);
              
              return;
            }
            
            setErrorMessage(errorText || 'Failed to generate analysis');
          } catch (textError) {
            // If all else fails, use the status text
            setErrorMessage(`Error ${response.status}: ${response.statusText || 'Unknown error'}`);
          }
        }
        
        setIsAnalyzing(false);
        setAnalysisStatus('error');
        return;
      }
      
      const data = await response.json();
      
      console.log('Analysis generated successfully:', data);
      
      // Verify that the database was updated correctly
      const { data: updatedRecord, error: fetchError } = await supabase
        .from('transcriptions')
        .select('id, analysis_data, analysis_status, transcription_text, status, created_at, media_path, media_url, user_id, summary_text, summary_status')
        .eq('id', transcriptionId)
        .single();
      
      if (fetchError) {
        console.error('Error verifying analysis update:', fetchError);
        setErrorMessage('Error verifying analysis update');
      } else {
        console.log('Verified analysis update. Analysis status:', updatedRecord.analysis_status);
        console.log('Analysis data present:', !!updatedRecord.analysis_data);
        
        // Map the database record to a TranscriptionRecord using the utility function
        const mappedRecord = mapDbRecordToTranscriptionRecord(updatedRecord);
        
        // Update the transcription record in state
        setTranscriptionRecord(prev => {
          if (!prev) return prev;
          
          // Create a properly typed analysisData object
          const safeAnalysisData = mappedRecord.analysisData || prev.analysisData || {
            sentiment: 'neutral',
            sentiment_explanation: '',
            pain_points: [],
            feature_requests: []
          };
          
          // Ensure analysis data is properly set
          return {
            ...mappedRecord,
            analysisData: safeAnalysisData
          };
        });
        
        // Set the analysis data for display
        setAnalysisData(updatedRecord.analysis_data);
      }
      
      // Update state to show we've completed generating an analysis
      setIsAnalyzing(false);
      setAnalysisStatus('completed');
      setErrorMessage(null);
      
    } catch (error: any) {
      console.error('Error generating analysis:', error);
      setIsAnalyzing(false);
      setAnalysisStatus('error');
      setErrorMessage('Failed to generate analysis: ' + (error.message || 'Unknown error'));
    }
  };

  const triggerAnalysis = async () => {
    if (!transcriptionRecord) {
      console.error('No transcription record available for analysis');
      setErrorMessage('No transcription record available for analysis');
      return;
    }
    
    try {
      // Check if transcription is complete before proceeding
      if (transcriptionRecord.status !== 'completed') {
        console.log('Transcription is not complete yet, cannot analyze');
        setErrorMessage('Please wait for transcription to complete before analyzing');
        
        // Set a visual indicator that we're waiting for transcription
        setAnalysisStatus('pending');
        
        // Poll for transcription completion
        const pollInterval = setInterval(async () => {
          try {
            const { data: latestRecord, error: pollError } = await supabase
              .from('transcriptions')
              .select('*')
              .eq('id', transcriptionRecord.id)
              .single();
              
            if (pollError) {
              console.error('Error fetching transcription status:', pollError);
              return;
            }
            
            if (latestRecord && latestRecord.status === 'completed') {
              console.log('Transcription now complete, proceeding with analysis');
              clearInterval(pollInterval);
              
              // Update the transcription record
              if (latestRecord) {
                const updatedRecord = mapDbRecordToTranscriptionRecord(latestRecord);
                if (updatedRecord) {
                  setTranscriptionRecord(updatedRecord);
                  
                  // Now that transcription is complete, proceed with analysis
                  setIsAnalyzing(true);
                  setAnalysisStatus('processing');
                  requestAnalysis(transcriptionRecord.id);
                }
              }
            } else {
              console.log('Transcription still in progress, waiting...');
            }
          } catch (error) {
            console.error('Error polling for transcription status:', error);
          }
        }, 5000); // Poll every 5 seconds
        
        // Stop polling after 5 minutes (60 polls)
        setTimeout(() => {
          clearInterval(pollInterval);
          console.log('Stopped polling for transcription completion after timeout');
          setAnalysisStatus('error');
          setErrorMessage('Transcription is taking too long. Please try again later.');
        }, 300000);
        
        return;
      }
      
      // If we reach here, transcription is complete, proceed with analysis
      setIsAnalyzing(true);
      setAnalysisStatus('processing');
      
      // Get the access token
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch (error) {
        console.error('Failed to get access token:', error);
      }
      
      // Prepare request payload
      const payload = {
        transcriptionId: transcriptionRecord.id,
        accessToken
      };
      
      // Validate payload before sending
      if (!payload.transcriptionId) {
        throw new Error('Missing transcription ID in payload');
      }
      
      const payloadString = JSON.stringify(payload);
      console.log('Sending analysis request with payload:', payloadString.substring(0, 100) + (payloadString.length > 100 ? '...' : ''));
      
      // Request the analysis
      requestAnalysis(transcriptionRecord.id)
        .then(() => {
          console.log('Analysis completed successfully');
        })
        .catch((error) => {
          console.error('Analysis failed:', error);
          setErrorMessage('Failed to analyze: ' + (error.message || 'Unknown error'));
        });
    } catch (error: any) {
      console.error('Error triggering analysis:', error);
      setIsAnalyzing(false);
      setAnalysisStatus('error');
    }
  };

  const renderStatusBanner = () => {
    let statusMessage = '';
    let icon = null;
    let bgColor = '';
    let textColor = '';
    let borderColor = '';
    
    if (isAnalyzing || transcriptionRecord?.analysisStatus === 'processing') {
      statusMessage = 'Analyzing the interview content...';
      icon = <Sparkles className="w-5 h-5 mr-2" />;
      bgColor = 'bg-amber-50';
      textColor = 'text-amber-700';
      borderColor = 'border-amber-200';
    } else if (isSummarizing || transcriptionRecord?.summaryStatus === 'processing') {
      statusMessage = 'Generating summary...';
      icon = <FileText className="w-5 h-5 mr-2" />;
      bgColor = 'bg-blue-50';
      textColor = 'text-blue-700';
      borderColor = 'border-blue-200';
    } else if (transcriptionRecord?.summaryText && transcriptionRecord?.analysisData && transcriptionRecord?.analysisStatus === 'completed') {
      statusMessage = `${transcriptionRecord.fileName}: Transcription, summary and analysis complete.`;
      icon = <CheckCircle className="w-5 h-5 mr-2" />;
      bgColor = 'bg-green-50';
      textColor = 'text-green-700';
      borderColor = 'border-green-200';
    } else if (transcriptionRecord?.summaryText) {
      statusMessage = `${transcriptionRecord.fileName}: Transcription and summary complete.`;
      icon = <CheckCircle className="w-5 h-5 mr-2" />;
      bgColor = 'bg-green-50';
      textColor = 'text-green-700';
      borderColor = 'border-green-200';
    } else {
      statusMessage = `${transcriptionRecord?.fileName}: Transcription complete.`;
      icon = <CheckCircle className="w-5 h-5 mr-2" />;
      bgColor = 'bg-green-50';
      textColor = 'text-green-700';
      borderColor = 'border-green-200';
    }
    
    return (
      <div className={`mb-6 p-4 rounded-lg border ${bgColor} ${borderColor} shadow-sm`}>
        <div className={`flex items-center ${textColor}`}>
          {icon}
          <span className="font-medium">{statusMessage}</span>
        </div>
      </div>
    );
  };
  
  const renderTranscriptionContent = () => {
    return (
      <div className="mb-8 rounded-xl bg-white border border-gray-200 shadow-md overflow-hidden">
        <div className="p-6 sm:p-8 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">Interview Results</h2>
            <div className="flex items-center text-sm text-gray-500">
              <Clock className="h-4 w-4 mr-1" />
              <span>
                {transcriptionRecord?.createdAt 
                  ? new Date(transcriptionRecord.createdAt).toLocaleString() 
                  : 'Recently processed'}
              </span>
            </div>
          </div>
          <Tabs defaultValue="transcription" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4 bg-gray-100">
              <TabsTrigger value="transcription" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <FileText className="h-4 w-4 mr-2" />
                Transcription
              </TabsTrigger>
              <TabsTrigger 
                value="summary" 
                disabled={!transcriptionRecord?.transcriptionText}
                className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <ListTodo className="h-4 w-4 mr-2" />
                Summary
              </TabsTrigger>
              <TabsTrigger 
                value="analysis" 
                disabled={!transcriptionRecord?.transcriptionText}
                className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <BarChart className="h-4 w-4 mr-2" />
                Analysis
              </TabsTrigger>
            </TabsList>

            <TabsContent value="transcription" className="pt-4">
              {!transcriptionRecord?.transcriptionText ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p>No transcription available</p>
                </div>
              ) : (
                <div className="bg-white rounded-md p-4 max-h-96 overflow-y-auto border border-gray-100">
                  <pre className="whitespace-pre-wrap font-sans text-gray-800">
                    {transcriptionRecord.transcriptionText}
                  </pre>
                </div>
              )}
              
              {transcriptionRecord && !transcriptionRecord.summaryText && (
                <div className="mt-4 flex justify-end">
                  {isSummarizing && (
                    <div className="flex items-center text-indigo-600">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating summary...
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="summary" className="pt-4">
              {/* Debug information */}
              <div style={{ display: 'none' }}>
                {JSON.stringify({
                  summaryText: transcriptionRecord?.summaryText,
                  isPlaceholder: transcriptionRecord?.isPlaceholderSummary,
                  summaryStatus: transcriptionRecord?.summaryStatus
                })}
              </div>
              
              {!transcriptionRecord ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p>No transcription available yet</p>
                </div>
              ) : transcriptionRecord.status !== 'completed' ? (
                <div className="p-6 text-center text-gray-500">
                  <Clock className="h-12 w-12 text-amber-400 mx-auto mb-2" />
                  <p className="font-medium text-amber-600">Waiting for transcription to complete...</p>
                  <p className="text-sm text-gray-500 mt-2">Summary will be automatically generated when transcription is finished.</p>
                </div>
              ) : !transcriptionRecord.summaryText ? (
                <div className="p-6 text-center text-gray-500">
                  <Loader2 className="h-12 w-12 text-blue-400 mx-auto mb-2 animate-spin" />
                  <p className="font-medium text-blue-600">Generating summary...</p>
                  <p className="text-sm text-gray-500 mt-2">This may take a few moments.</p>
                </div>
              ) : transcriptionRecord.isPlaceholderSummary ? (
                <div className="bg-white rounded-md p-4 max-h-96 overflow-y-auto border border-gray-100">
                  <div className="flex items-center justify-center p-4 text-amber-600 bg-amber-50 rounded-md mb-4">
                    <Info className="h-5 w-5 mr-2" />
                    <p>Waiting for the complete transcription before generating a detailed summary.</p>
                  </div>
                  <div className="prose max-w-none text-gray-800">
                    {transcriptionRecord.summaryText}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-md p-4 max-h-96 overflow-y-auto border border-gray-100">
                  <div className="prose max-w-none text-gray-800">
                    {transcriptionRecord.summaryText}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="analysis" className="pt-4">
              {!transcriptionRecord ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p>No transcription available yet</p>
                </div>
              ) : transcriptionRecord.status !== 'completed' ? (
                <div className="p-6 text-center text-gray-500">
                  <Clock className="h-12 w-12 text-amber-400 mx-auto mb-2" />
                  <p className="font-medium text-amber-600">Waiting for transcription to complete...</p>
                  <p className="text-sm text-gray-500 mt-2">Analysis will be automatically generated when transcription is finished.</p>
                </div>
              ) : isAnalyzing || (transcriptionRecord.analysisStatus === 'processing') ? (
                <div className="p-6 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <div className="relative w-16 h-16 mb-4">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">Analyzing your transcript</h3>
                    <p className="text-sm text-gray-500 mt-2">This may take a minute or two...</p>
                  </div>
                </div>
              ) : !transcriptionRecord.analysisData ? (
                <div className="p-6 text-center text-gray-500">
                  <BarChart2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p>Analysis will be generated automatically</p>
                </div>
              ) : (
                <div className="space-y-6 p-4">
                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4 shadow-sm">
                    <div className="flex items-center mb-2">
                      <Heart className="h-5 w-5 mr-2 text-rose-500" />
                      <h3 className="text-lg font-medium">Customer Sentiment</h3>
                    </div>
                    <div className="flex flex-col gap-2">
                      {(() => {
                        // Using IIFE for better type handling
                        const sentimentData = transcriptionRecord?.analysisData?.sentiment;
                        
                        if (!sentimentData) {
                          return <span className="text-gray-500">No sentiment data available</span>;
                        }
                        
                        const sentimentString = String(sentimentData).toLowerCase();
                        
                        let bgColorClass = 'bg-gray-100 text-gray-800';
                        if (sentimentString.includes('positive')) {
                          bgColorClass = 'bg-green-100 text-green-800';
                        } else if (sentimentString.includes('neutral')) {
                          bgColorClass = 'bg-blue-100 text-blue-800';
                        } else if (sentimentString.includes('negative')) {
                          bgColorClass = 'bg-red-100 text-red-800';
                        } else if (sentimentString.includes('mixed')) {
                          bgColorClass = 'bg-amber-100 text-amber-800';
                        }
                        
                        return (
                          <Badge className={`text-sm py-1 px-3 rounded-full ${bgColorClass}`}>
                            {String(sentimentData)}
                          </Badge>
                        );
                      })()}
                    </div>
                    
                    {transcriptionRecord?.analysisData?.sentiment_explanation && (
                      <p className="text-gray-700 mt-2">{transcriptionRecord.analysisData.sentiment_explanation}</p>
                    )}
                  </div>

                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4 shadow-sm">
                    <div className="flex items-center mb-2">
                      <AlertOctagon className="h-5 w-5 mr-2 text-amber-500" />
                      <h3 className="text-lg font-medium">Pain Points</h3>
                    </div>
                    {Array.isArray(transcriptionRecord.analysisData.pain_points) && transcriptionRecord.analysisData.pain_points.length > 0 ? (
                      <ul className="space-y-2">
                        {transcriptionRecord.analysisData.pain_points.map((point, index) => (
                          <li key={index} className="text-sm">
                            {typeof point === 'string' ? 
                              <div className="flex items-start">
                                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium mr-2">{index + 1}</span>
                                <span>{point}</span>
                              </div> : 
                              (point && typeof point === 'object' && 'issue' in point ? 
                                <div>
                                  <div className="flex items-start">
                                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium mr-2">{index + 1}</span>
                                    <strong>{point.issue}</strong>
                                  </div>
                                  <p className="ml-7">{point.description}</p>
                                  {Array.isArray(point.quotes) && point.quotes.length > 0 && (
                                    <blockquote className="ml-7 pl-2 border-l-2 border-gray-300 mt-1 text-xs italic text-gray-600">
                                      "{point.quotes[0]}"
                                    </blockquote>
                                  )}
                                </div> : 
                                <div className="flex items-start">
                                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium mr-2">{index + 1}</span>
                                  <span>{JSON.stringify(point)}</span>
                                </div>
                              )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No pain points identified.</p>
                    )}
                  </div>

                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4 shadow-sm">
                    <div className="flex items-center mb-2">
                      <Lightbulb className="h-5 w-5 mr-2 text-indigo-500" />
                      <h3 className="text-lg font-medium">Feature Requests</h3>
                    </div>
                    {Array.isArray(transcriptionRecord.analysisData.feature_requests) && transcriptionRecord.analysisData.feature_requests.length > 0 ? (
                      <ul className="space-y-2">
                        {transcriptionRecord.analysisData.feature_requests.map((feature, index) => (
                          <li key={index} className="text-sm">
                            {typeof feature === 'string' ? feature : 
                             (feature && typeof feature === 'object' && 'feature' in feature ? 
                              <div>
                                <div className="flex items-start">
                                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-medium mr-2">{index + 1}</span>
                                  <strong>{feature.feature}</strong>
                                </div>
                                <p className="ml-7">{feature.description}</p>
                                {Array.isArray(feature.quotes) && feature.quotes.length > 0 && (
                                  <blockquote className="ml-7 pl-2 border-l-2 border-gray-300 mt-1 text-xs italic text-gray-600">
                                    "{feature.quotes[0]}"
                                  </blockquote>
                                )}
                              </div> : 
                              JSON.stringify(feature))}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No feature requests identified.</p>
                    )}
                  </div>

                  {(Array.isArray(transcriptionRecord.analysisData.topics) && transcriptionRecord.analysisData.topics.length > 0) || (Array.isArray(transcriptionRecord.analysisData.keyInsights) && transcriptionRecord.analysisData.keyInsights.length > 0) ? (
                    <div className="border rounded-lg p-4 space-y-2">
                      {Array.isArray(transcriptionRecord.analysisData.topics) && transcriptionRecord.analysisData.topics.length > 0 && (
                        <div>
                          <div className="flex items-center space-x-2">
                            <Hash className="h-5 w-5 text-blue-500" />
                            <h3 className="text-lg font-medium">Topics</h3>
                          </div>
                          <ul className="space-y-1 mt-2">
                            {transcriptionRecord.analysisData.topics.map((topicItem, index) => (
                              <li key={index} className="text-sm">{topicItem.topic}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {Array.isArray(transcriptionRecord.analysisData.keyInsights) && transcriptionRecord.analysisData.keyInsights.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center space-x-2">
                            <KeyRound className="h-5 w-5 text-emerald-500" />
                            <h3 className="text-lg font-medium">Key Insights</h3>
                          </div>
                          <ul className="space-y-1 mt-2">
                            {transcriptionRecord.analysisData.keyInsights.map((insightItem, index) => (
                              <li key={index} className="text-sm">{insightItem.insight}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  };

  const renderChatAssistant = () => {
    if (!transcriptionRecord?.transcriptionText) return null;
    
    // Ensure we have a complete transcription record with proper ID formatting
    const formattedRecord = {
      ...transcriptionRecord,
      id: String(transcriptionRecord.id), // Ensure ID is a string
      fileName: transcriptionRecord.fileName || 'Interview', // Provide fallback
      transcriptionText: transcriptionRecord.transcriptionText || '', // Ensure text exists
      analysisData: transcriptionRecord.analysisData || {
        sentiment: 'neutral',
        sentiment_explanation: '',
        pain_points: [],
        feature_requests: []
      },
      analysisStatus: transcriptionRecord.analysisStatus || 'pending'
    };
    
    // More detailed debug for the chat component
    console.log('MediaUploader: Passing transcription record to chat:', {
      id: formattedRecord.id,
      type: typeof formattedRecord.id,
      idAsString: String(formattedRecord.id),
      fileName: formattedRecord.fileName,
      hasText: !!formattedRecord.transcriptionText?.length,
      textLength: formattedRecord.transcriptionText?.length,
      hasAnalysis: !!formattedRecord.analysisData,
      analysisStatus: formattedRecord.analysisStatus
    });
    
    return (
      <TranscriptChat 
        transcriptionRecord={formattedRecord}
      />
    );
  };

  useEffect(() => {
    if (transcriptionRecord) {
      console.log('TranscriptionRecord updated:', {
        id: transcriptionRecord.id,
        summaryText: transcriptionRecord.summaryText?.substring(0, 50) + '...',
        summaryStatus: transcriptionRecord.summaryStatus,
        isPlaceholderSummary: transcriptionRecord.isPlaceholderSummary,
        transcriptionStatus: transcriptionRecord.status
      });
    }
  }, [transcriptionRecord]);

  useEffect(() => {
    const autoProcessTranscription = async () => {
      // Skip if no transcription record or if it doesn't have both ID and text
      if (!transcriptionRecord || !transcriptionRecord.id || !transcriptionRecord.transcriptionText) {
        return;
      }
      
      // Check authentication first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('Authentication required for auto-processing - user is not logged in');
        return; // Exit early without error if not authenticated
      }
      
      // Auto-generate summary if it's not already summarized or in progress
      if (transcriptionRecord.summaryStatus !== 'completed' && 
          transcriptionRecord.summaryStatus !== 'processing') {
        try {
          console.log('Auto-triggering summary for transcription:', transcriptionRecord.id);
          await generateSummaryForTranscription(transcriptionRecord.id, transcriptionRecord.transcriptionText);
        } catch (error) {
          console.error('Auto-summary generation failed:', error);
        }
      }
      
      // Auto-analyze sentiment if it's not already analyzed or in progress
      if (transcriptionRecord.analysisStatus !== 'completed' && 
          transcriptionRecord.analysisStatus !== 'processing') {
        try {
          console.log('Auto-triggering analysis for transcription:', transcriptionRecord.id);
          await requestAnalysis(transcriptionRecord.id);
        } catch (error) {
          console.error('Auto-sentiment analysis failed:', error);
        }
      }
    };
    
    // Only run if transcription record has changed and has valid data
    if (transcriptionRecord && transcriptionRecord.id && transcriptionRecord.transcriptionText) {
      autoProcessTranscription();
    }
    
    // Explicitly list all external functions in the dependency array
    // but exclude the transcriptionRecord.transcriptionText to prevent infinite loops
  }, [
    transcriptionRecord?.id, 
    transcriptionRecord?.status,
    transcriptionRecord?.summaryStatus,
    transcriptionRecord?.analysisStatus,
    generateSummaryForTranscription, 
    requestAnalysis, 
    supabase
  ]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setShowAuthPrompt(true);
      } else {
        setShowAuthPrompt(false);
      }
    };

    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setShowAuthPrompt(true);
        // Clear any sensitive data when user signs out
        setTranscriptionRecord(null);
        setSelectedFile(null);
      } else if (event === 'SIGNED_IN') {
        setShowAuthPrompt(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Call the debug function when the component mounts or when the transcription record changes
  useEffect(() => {
    if (transcriptionRecord?.id) {
      console.log('Transcription record changed, checking summary status...');
      debugCheckSummaryStatus(transcriptionRecord.id);
    }
  }, [transcriptionRecord?.id]);

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

  const saveSummaryData = async (transcriptionId: string, summaryData: any) => {
    console.log('Saving summary data for transcription:', transcriptionId);
    setLoadingState('saving');
    
    try {
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('You must be logged in to save summary data. Please sign in and try again.');
      }
      
      // Call the API to save the summary data
      const response = await fetch('/api/transcription/update-summary', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          transcriptionId,
          summaryData
        }),
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        let errorMessage = 'Failed to save summary data';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonError: any) {
          try {
            const errorText = await responseClone.text();
            console.error('Raw error response:', errorText);
            
            // Check for rate limit errors in the text
            if (errorText.includes('rate limit') || errorText.includes('429')) {
              console.log('Rate limit reached, will retry in 10 seconds');
              setErrorMessage('OpenAI rate limit reached. Retrying in 10 seconds...');
              
              // Keep the summarizing state but update UI to show waiting
              setSummaryStatus('waiting');
              
              // Set a timeout to retry after 10 seconds
              setTimeout(() => {
                console.log('Retrying summary generation after rate limit cooldown');
                setSummaryRequestInProgress(false);
                generateSummaryForTranscription(transcriptionId, '');
              }, 10000);
              
              return;
            }
            
            setErrorMessage(errorText || 'Failed to save summary data');
          } catch (textError) {
            // If all else fails, use the status text
            setErrorMessage(`Error ${response.status}: ${response.statusText || 'Unknown error'}`);
          }
        }
        
        throw new Error(errorMessage);
      }
      
      try {
        const data = await response.json();
        console.log('Summary data saved successfully:', data);
        setUpdateMessage('Summary saved successfully');
        return true;
      } catch (error: any) {
        console.error('Error parsing save summary response:', error);
        
        // If JSON parsing fails, try to read the response as text
        try {
          const textResponse = await responseClone.text();
          console.error('Raw save summary response:', textResponse);
          throw new Error('Invalid response from server. Please try again.');
        } catch (textError) {
          console.error('Error reading save summary response text:', textError);
          throw new Error('Failed to read save summary response');
        }
      }
    } catch (error: any) {
      console.error('Error saving summary data:', error);
      setErrorMessage(`Failed to save summary data: ${error.message || 'Unknown error'}`);
      return false;
    } finally {
      setLoadingState('idle');
    }
  };

  const saveAnalysisData = async (transcriptionId: string, analysisData: any): Promise<boolean> => {
    try {
      console.log('Saving analysis data to database for transcription:', transcriptionId);
      
      // Get the current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        console.error('No access token available for saving analysis data');
        return false;
      }
      
      // Make the API call to save the analysis data
      const response = await fetch('/api/transcription/update-analysis', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          transcriptionId,
          analysisData,
          analysisStatus: 'completed'
        })
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        // Clone the response so we can read it multiple times if needed
        const responseClone = response.clone();
        
        let errorData: { error: string; details: string | null } = { 
          error: 'Unknown error', 
          details: null 
        };
        
        try {
          errorData = await response.json();
        } catch (jsonError: any) {
          try {
            const responseText = await responseClone.text();
            console.error('Raw error response:', responseText.substring(0, 200)); // Log first 200 chars
            errorData = {
              error: 'Server error',
              details: responseText.substring(0, 100)
            };
          } catch (textError) {
            console.error('Failed to read error response:', textError);
          }
        }
        
        // Check if this is an authentication error
        const isAuthError = response.status === 401 || 
                           errorData.error?.toLowerCase().includes('auth') || 
                           errorData.error?.toLowerCase().includes('token') || 
                           errorData.error?.toLowerCase().includes('permission');
        
        // If it's an auth error, try to refresh the token and retry
        if (isAuthError) {
          console.log('Authentication error detected when saving analysis, attempting to refresh session...');
          
          try {
            // Try to refresh the session
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError) {
              console.error('Failed to refresh session:', refreshError);
              setErrorMessage('Your session has expired. Please sign in again.');
              return false;
            }
            
            if (refreshData.session) {
              console.log('Session refreshed, retrying analysis save...');
              
              // Retry the API call with the new token
              const retryResponse = await fetch('/api/transcription/update-analysis', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${refreshData.session.access_token}`
                },
                body: JSON.stringify({
                  transcriptionId,
                  analysisData,
                  analysisStatus: 'completed'
                })
              });
              
              if (!retryResponse.ok) {
                throw new Error('Failed to save analysis data even after refreshing session');
              }
              
              // Process the successful response
              const data = await retryResponse.json();
              console.log('Analysis data saved successfully after session refresh:', data);
              return true;
            }
          } catch (refreshError) {
            console.error('Error during session refresh or retry:', refreshError);
          }
        }
        
        const errorMessage = errorData.error || 'Failed to save analysis data';
        console.error('Error saving analysis data:', errorMessage);
        setErrorMessage(errorMessage);
        return false;
      }
      
      const data = await response.json();
      
      // Check if this is a simulated success response in development mode
      if (data.warning && data.warning.includes('simulated')) {
        console.warn('Development mode: Analysis data save was simulated:', data);
        
        // Even though it's simulated, we'll treat it as a success for UI purposes
        console.log('Treating simulated response as success for UI purposes');
        setErrorMessage(null);
        return true;
      }
      
      console.log('Analysis data saved successfully:', data);
      setErrorMessage(null);
      return true;
    } catch (error: any) {
      console.error('Exception saving analysis data:', error);
      setErrorMessage('Failed to save analysis data: ' + (error.message || 'Unknown error'));
      return false;
    }
  };

  // Debug function to check summary status directly from the database
  const debugCheckSummaryStatus = async (transcriptionId: string) => {
    if (!transcriptionId) return;
    
    try {
      console.log('DEBUG: Checking summary status for ID:', transcriptionId);
      const { data: record, error } = await supabase
        .from('transcriptions')
        .select('id, summary_text, summary_status')
        .eq('id', transcriptionId)
        .single();
        
      if (error) {
        console.error('DEBUG: Error fetching summary status:', error.message);
        return;
      }
      
      if (!record) {
        console.log('DEBUG: No record found with ID:', transcriptionId);
        return;
      }
      
      // Determine if this is likely a placeholder summary based on the text content
      const summaryText = record.summary_text || '';
      const isPlaceholderSummary = summaryText.includes('processing message') || 
                                   summaryText.includes('wait for the complete transcription');
      
      console.log('DEBUG: Database summary status:', {
        id: record.id,
        summary_text: record.summary_text?.substring(0, 50) + '...',
        summary_status: record.summary_status,
        detected_placeholder: isPlaceholderSummary
      });
    } catch (error) {
      console.error('DEBUG: Error checking summary status:', error);
    }
  };

  useEffect(() => {
    const autoGenerateWhenTranscriptionAvailable = async () => {
      // Only proceed if we have a valid transcription record with ID and text
      if (!transcriptionRecord || !transcriptionRecord.id || !transcriptionRecord.transcriptionText) {
        console.log('Skipping auto-generation: Missing transcription ID or text');
        return;
      }
      
      console.log('Transcription available, checking if summary and analysis need to be generated');
      
      // Check authentication first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('Authentication required for auto-generation - user is not logged in');
        return; // Exit early without error if not authenticated
      }
      
      // Auto-generate summary if needed
      if ((!transcriptionRecord.summaryText || transcriptionRecord.isPlaceholderSummary) && 
          transcriptionRecord.summaryStatus !== 'processing') {
        console.log('Auto-generating summary for available transcription');
        try {
          await generateSummaryForTranscription(
            transcriptionRecord.id, 
            transcriptionRecord.transcriptionText
          );
        } catch (error) {
          console.error('Auto-summary generation failed:', error);
        }
      }
      
      // Auto-generate analysis if needed
      if (!transcriptionRecord.analysisData && 
          transcriptionRecord.analysisStatus !== 'processing') {
        console.log('Auto-generating analysis for available transcription');
        try {
          await requestAnalysis(transcriptionRecord.id);
        } catch (error) {
          console.error('Auto-analysis generation failed:', error);
        }
      }
    };
    
    // Only run the effect if we have a valid transcription record
    if (transcriptionRecord && transcriptionRecord.id && transcriptionRecord.transcriptionText) {
      autoGenerateWhenTranscriptionAvailable();
    }
    
    // Explicitly list all external functions in the dependency array
    // but exclude the transcriptionRecord.transcriptionText to prevent infinite loops
  }, [
    transcriptionRecord?.id, 
    transcriptionRecord?.status,
    transcriptionRecord?.summaryStatus,
    transcriptionRecord?.analysisStatus,
    generateSummaryForTranscription, 
    requestAnalysis, 
    supabase
  ]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">InsightAI - Customer Interview Analysis</h1>
      
      {showAuthPrompt ? (
        <Card className="mb-6 border border-gray-200 shadow-md overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 pb-6">
            <CardTitle className="text-2xl text-gray-800">Authentication Required</CardTitle>
            <CardDescription className="text-gray-600">Please sign in to use the InsightAI platform</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center mb-4 p-4 bg-blue-50 rounded-md border border-blue-100 text-blue-700">
              <div className="mr-3 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 000 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
                </svg>
              </div>
              <p>You need to be signed in to upload and analyze interviews.</p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end bg-gray-50 border-t border-gray-100">
            <Button 
              onClick={() => window.location.href = '/auth?returnUrl=/transcribe'}
              className="bg-indigo-600 hover:bg-indigo-700 transition-all duration-200"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <>
          {/* Status banner */}
          {transcriptionRecord && renderStatusBanner()}
          
          {/* File upload section with modern design */}
          <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden">
            <div className="p-6 sm:p-8 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200">
              <h2 className="text-xl font-semibold mb-2 text-gray-800">Upload Interview</h2>
              <p className="text-gray-600">Upload audio or video files to transcribe and analyze customer interviews</p>
            </div>
            
            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-col space-y-3">
                <label 
                  htmlFor="file-input" 
                  className="text-sm font-medium text-gray-700"
                >
                  Select audio or video file
                </label>
                <div className="flex flex-col space-y-2">
                  <div className="relative">
                    <input
                      id="file-input"
                      type="file"
                      accept="audio/*,video/*"
                      disabled={isSubmitting}
                      onChange={handleFilesSelected}
                      className="w-full rounded-lg border-2 border-dashed border-gray-300 py-8 px-4 text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 focus:outline-none cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[-1]">
                      <FileAudio className="h-12 w-12 text-gray-300" />
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                    <div className="flex items-center">
                      <Info className="w-4 h-4 mr-2 text-indigo-500" />
                      <span>Supported formats:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 bg-gray-200 rounded text-xs">MP3</span>
                      <span className="px-2 py-1 bg-gray-200 rounded text-xs">MP4</span>
                      <span className="px-2 py-1 bg-gray-200 rounded text-xs">WAV</span>
                      <span className="px-2 py-1 bg-gray-200 rounded text-xs">M4A</span>
                    </div>
                    <span className="text-xs">Max size: 25MB</span>
                  </div>
                  
                  {selectedFile && (
                    <div className="flex items-center p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-800">
                      <FileCheck className="h-5 w-5 text-blue-600 mr-2" />
                      <div className="flex-1 truncate">
                        <span className="font-medium">{selectedFile.name}</span>
                        <span className="ml-2 text-xs">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedFile(null)}
                        className="ml-2 text-gray-500 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex justify-end mt-4">
                <Button 
                  type="button" 
                  disabled={isSubmitting || !selectedFile} 
                  onClick={handleSubmit}
                  className="bg-indigo-600 hover:bg-indigo-700 transition-colors w-full sm:w-auto flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload & Analyze
                    </>
                  )}
                </Button>
              </div>
              
              {uploadProgress > 0 && (
                <div className="w-full mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span>Uploading...</span>
                    <span>{uploadProgress.toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              
              {error && (
                <div className="w-full p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 mt-4">
                  <div className="flex items-center">
                    <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
                    <p>{error}</p>
                  </div>
                </div>
              )}
              
              {isTranscribing && (
                <div className="w-full flex flex-col items-center justify-center space-y-3 py-6">
                  <div className="relative">
                    <div className="h-16 w-16 rounded-full border-t-4 border-b-4 border-indigo-500 animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FileText className="h-6 w-6 text-indigo-600" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-gray-800">Transcribing your file...</p>
                    <p className="text-sm text-gray-500 mt-1">This may take a few minutes depending on the file size</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Transcription content in a nicely designed container */}
          {transcriptionRecord && renderTranscriptionContent()}
          
          {/* Chat Assistant Section with improved styling */}
          {transcriptionRecord?.transcriptionText && (
            <div className="mb-6 rounded-xl border border-indigo-200 bg-white shadow-md overflow-hidden">
              <div className="p-6 sm:p-8 bg-gradient-to-r from-indigo-50 to-indigo-100 border-b border-indigo-200">
                <h2 className="text-xl font-semibold mb-2 flex items-center gap-2 text-gray-800">
                  <Bot className="h-5 w-5 text-indigo-600" />
                  Interview Chat Assistant
                </h2>
                <p className="text-gray-600">
                  Ask questions about the interview to get deeper insights. For example: "What were the main pain points?" or "Summarize the feature requests."
                </p>
              </div>
              <div className="p-0">
                <TranscriptChat transcriptionRecord={transcriptionRecord} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface AnalysisData {
  sentiment: 'positive' | 'neutral' | 'negative';
  sentiment_explanation: string;
  pain_points: Array<{
    issue: string;
    description: string;
    quotes: string[];
  }>;
  feature_requests: Array<{
    feature: string;
    description: string;
    quotes: string[];
  }>;
  topics?: Array<{
    topic: string;
  }>;
  keyInsights?: Array<{
    insight: string;
  }>;
}
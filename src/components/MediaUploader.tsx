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

  const fetchTranscriptionData = async (transcriptionId: string) => {
    if (!transcriptionId) return null;
    
    try {
      console.log('Directly fetching transcription data for ID:', transcriptionId);
      
      const { data, error } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', transcriptionId)
        .single();
        
      if (error) {
        console.error('Error fetching transcription data:', error);
        return null;
      }
      
      if (!data) {
        console.log('No transcription found with ID:', transcriptionId);
        return null;
      }
      
      console.log('Successfully fetched transcription data:', {
        id: data.id,
        status: data.status,
        hasSummary: !!data.summary_text,
        summaryStatus: data.summary_status,
        hasAnalysis: !!data.analysis_data,
        analysisStatus: data.analysis_status
      });
      
      return data;
    } catch (error) {
      console.error('Exception fetching transcription data:', error);
      return null;
    }
  };
  
  const updateUIWithLatestData = async () => {
    if (!currentTranscriptionId) return;
    
    try {
      const data = await fetchTranscriptionData(currentTranscriptionId);
      if (!data) return;
      
      // Map the database record to our frontend format
      const mappedRecord = mapDbRecordToTranscriptionRecord(data);
      
      // Update the UI state with the latest data
      setTranscriptionRecord(mappedRecord);
      
      // Update processing states based on the data
      setIsTranscribing(data.status === 'processing');
      setIsSummarizing(data.summary_status === 'processing');
      setIsAnalyzing(data.analysis_status === 'processing');
      
      // Update status messages
      if (data.status === 'error') {
        setErrorMessage(`Transcription error: ${data.error || 'Unknown error'}`);
      } else if (data.summary_status === 'error') {
        setErrorMessage('Error generating summary. Please try again.');
      } else if (data.analysis_status === 'error') {
        setErrorMessage('Error analyzing content. Please try again.');
      } else {
        setErrorMessage(null);
      }
    } catch (error) {
      console.error('Error updating UI with latest data:', error);
    }
  };

  const generateSummaryForTranscription = async (transcriptionId: string, transcriptionText: string) => {
    if (summaryRequestInProgress) {
      console.log('Summary request already in progress, skipping duplicate request');
      return;
    }
    
    console.log('Generating summary for transcription:', transcriptionId);
    setIsSummarizing(true);
    setSummaryRequestInProgress(true);
    setSummaryStatus('processing');
    
    try {
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('You must be logged in to generate a summary. Please sign in and try again.');
      }
      
      // Call the API to generate the summary
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          transcriptionId,
          transcriptionText,
          cacheBuster: Date.now() // Add cache-busting timestamp
        }),
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        let errorMessage = 'Failed to generate summary';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonError: any) {
          try {
            const errorText = await responseClone.text();
            console.error('Raw error response:', errorText);
            errorMessage = errorText || errorMessage;
          } catch (textError) {
            // If all else fails, use the status text
            errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('Summary generated successfully:', data);
      
      // Update the UI with the latest data
      await updateUIWithLatestData();
      
      setSummaryStatus('completed');
      return data;
    } catch (error: any) {
      console.error('Error generating summary:', error);
      setErrorMessage(`Failed to generate summary: ${error.message || 'Unknown error'}`);
      setSummaryStatus('error');
      return null;
    } finally {
      setIsSummarizing(false);
      setSummaryRequestInProgress(false);
    }
  };

  const requestAnalysis = async (transcriptionId: string) => {
    if (analysisStatus === 'processing' || analysisStatus === 'pending') {
      console.log('Analysis request already in progress, skipping duplicate request');
      return;
    }
    
    console.log('Requesting analysis for transcription:', transcriptionId);
    setIsAnalyzing(true);
    setAnalysisStatus('processing');
    
    try {
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('You must be logged in to analyze a transcription. Please sign in and try again.');
      }
      
      // Call the API to analyze the transcription
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          transcriptionId,
          cacheBuster: Date.now() // Add cache-busting timestamp
        }),
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        let errorMessage = 'Failed to analyze transcription';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonError: any) {
          try {
            const errorText = await responseClone.text();
            console.error('Raw error response:', errorText);
            errorMessage = errorText || errorMessage;
          } catch (textError) {
            // If all else fails, use the status text
            errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('Analysis completed successfully:', data);
      
      // Update the UI with the latest data
      await updateUIWithLatestData();
      
      setAnalysisStatus('completed');
      return data;
    } catch (error: any) {
      console.error('Error analyzing transcription:', error);
      setErrorMessage(`Failed to analyze transcription: ${error.message || 'Unknown error'}`);
      setAnalysisStatus('error');
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderStatusBanner = () => {
    let statusMessage = '';
    let statusClass = 'info';
    
    // Determine the current status based on the state of the transcription
    if (isUploading) {
      statusMessage = 'Uploading your media file...';
    } else if (isTranscribing) {
      statusMessage = 'Transcribing your audio...';
    } else if (transcriptionRecord?.status === 'processing') {
      statusMessage = 'Transcription in progress...';
    } else if (transcriptionRecord?.status === 'completed') {
      // Only show meaningful status updates for summary and analysis
      // to prevent UI flickering
      if (transcriptionRecord.summaryStatus === 'processing') {
        // Don't show intermediate summary status to prevent flickering
        statusMessage = 'Processing your transcription...';
      } else if (transcriptionRecord.analysisStatus === 'processing') {
        // Don't show intermediate analysis status to prevent flickering
        statusMessage = 'Processing your transcription...';
      } else if (transcriptionRecord.summaryStatus === 'error') {
        statusMessage = 'Error generating summary. Please try again.';
        statusClass = 'error';
      } else if (transcriptionRecord.analysisStatus === 'error') {
        statusMessage = 'Error analyzing content. Please try again.';
        statusClass = 'error';
      } else if (transcriptionRecord.status === 'error') {
        statusMessage = 'Error processing transcription. Please try again.';
        statusClass = 'error';
      }
    } else if (transcriptionRecord?.status === 'error') {
      statusMessage = 'Error processing transcription. Please try again.';
      statusClass = 'error';
    }
    
    // Only render the banner if there's a message to display
    if (!statusMessage) {
      return null;
    }
    
    return (
      <div className={`status-banner ${statusClass}`}>
        <div className="status-message">
          {statusMessage}
          {(isUploading || isTranscribing || 
            transcriptionRecord?.status === 'processing' ||
            transcriptionRecord?.summaryStatus === 'processing' ||
            transcriptionRecord?.analysisStatus === 'processing') && (
            <span className="loading-dots">
              <span className="dot">.</span>
              <span className="dot">.</span>
              <span className="dot">.</span>
            </span>
          )}
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
                  <div className="flex flex-col items-center justify-center space-y-3 py-6">
                    <div className="relative">
                      <div className="h-16 w-16 rounded-full border-t-4 border-b-4 border-indigo-500 animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <FileText className="h-6 w-6 text-indigo-600" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-gray-800">Analyzing your transcript...</p>
                      <p className="text-sm text-gray-500 mt-1">This may take a minute or two...</p>
                    </div>
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
    if (currentTranscriptionId) {
      updateUIWithLatestData();
    }
  }, [currentTranscriptionId]);

  useEffect(() => {
    if (!currentTranscriptionId) return;
    
    console.log('Setting up data refresh for transcription:', currentTranscriptionId);
    
    // Initial fetch
    updateUIWithLatestData();
    
    // Set up interval for periodic updates (every 30 seconds)
    const refreshInterval = setInterval(() => {
      updateUIWithLatestData();
    }, 30000);
    
    // Clean up on unmount
    return () => {
      clearInterval(refreshInterval);
    };
  }, [currentTranscriptionId]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <style jsx>{`
        .status-banner {
          margin-bottom: 1.5rem;
          padding: 1rem;
          border-radius: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .status-banner.info {
          background-color: #EFF6FF;
          border: 1px solid #BFDBFE;
          color: #1E40AF;
        }
        
        .status-banner.error {
          background-color: #FEF2F2;
          border: 1px solid #FECACA;
          color: #B91C1C;
        }
        
        .status-message {
          font-weight: 500;
          display: flex;
          align-items: center;
        }
        
        .loading-dots {
          display: inline-flex;
          margin-left: 0.25rem;
        }
        
        .dot {
          animation: pulse 1.5s infinite;
          margin-left: 0.125rem;
        }
        
        .dot:nth-child(2) {
          animation-delay: 0.3s;
        }
        
        .dot:nth-child(3) {
          animation-delay: 0.6s;
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
      
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
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0 8 8 0 01-16 0 8 8 0 00-16 0zM9 9a1 1 0 000 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
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
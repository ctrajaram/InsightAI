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
  const [transcriptionStatus, setTranscriptionStatus] = useState<'pending' | 'processing' | 'completed' | 'error'>('pending');
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTranscriptionId, setCurrentTranscriptionId] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState('');
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [loadingState, setLoadingState] = useState<'idle' | 'analyzing' | 'saving-analysis'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Use a ref to track which transcriptions we've already attempted to analyze
  const analysisAttempts = useRef<Set<string>>(new Set());

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
  
  // Function to refresh the user's session
  const refreshSession = async (): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.error('Failed to refresh session:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error refreshing session:', error);
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
            fileInfo = await uploadMediaFile(selectedFile, user.id);
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
        // Clone the response so we can read it multiple times if needed
        const responseClone = response.clone();
        
        let errorData;
        try {
          // First try to parse as JSON
          errorData = await response.json();
        } catch (jsonError) {
          // If JSON parsing fails, try to get text
          try {
            const errorText = await responseClone.text();
            console.error('Failed to parse error response as JSON:', errorText);
            // Create a valid error object from the text
            errorData = { 
              error: 'Server error', 
              details: errorText.substring(0, 100) // Only take first 100 chars to avoid huge errors
            };
          } catch (textError) {
            console.error('Failed to read response body as text:', textError);
            errorData = {
              error: 'Server error',
              details: 'Could not read server response'
            };
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
        
        throw new Error(errorMessage);
      }
      
      // Clone the response so we can read it multiple times if needed
      const responseClone = response.clone();
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Failed to parse successful response as JSON');
        try {
          const responseText = await responseClone.text();
          console.error('Raw response:', responseText.substring(0, 200)); // Log first 200 chars
        } catch (textError) {
          console.error('Could not read response body');
        }
        throw new Error('Invalid response from server. Please try again.');
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
      // Check authentication first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('Authentication required for summary generation - user is not logged in');
        return; // Exit early without error if not authenticated
      }
      
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
      
      // Validate the transcription text
      if (!transcriptionText || typeof transcriptionText !== 'string' || transcriptionText.trim() === '') {
        console.error('Invalid or empty transcription text');
        throw new Error('The transcription text is empty or invalid. Please try uploading again.');
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
          transcriptionText,
          accessToken: accessToken
        }),
        cache: 'no-store'
      });
      
      if (!response.ok) {
        // Clone the response so we can read it multiple times if needed
        const responseClone = response.clone();
        
        let errorData;
        try {
          // First try to parse as JSON
          errorData = await response.json();
        } catch (jsonError) {
          // If JSON parsing fails, try to get the text
          try {
            const errorText = await responseClone.text();
            console.error('Failed to parse error response as JSON:', errorText);
            // Create a valid error object from the text
            errorData = { 
              error: 'Server error', 
              details: errorText.substring(0, 100) // Only take first 100 chars to avoid huge errors
            };
          } catch (textError) {
            console.error('Failed to read response body as text:', textError);
            errorData = {
              error: 'Server error',
              details: 'Could not read server response'
            };
          }
        }
        
        const errorMessage = errorData.error || 'Failed to generate summary';
        
        throw new Error(errorMessage);
      }
      
      // Clone the response so we can read it multiple times if needed
      const responseClone = response.clone();
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Failed to parse successful response as JSON');
        try {
          const responseText = await responseClone.text();
          console.error('Raw response:', responseText.substring(0, 200)); // Log first 200 chars
        } catch (textError) {
          console.error('Could not read response body');
        }
        throw new Error('Invalid response from server. Please try again.');
      }
      
      console.log('Summary generated successfully:', data);
      
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

  // Helper function to retry operations with exponential backoff
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
    // Add a flag to track if we've already attempted analysis for this ID
    if (analysisAttempts.current.has(transcriptionId)) {
      console.log(`Analysis already attempted for transcription ${transcriptionId}, skipping`);
      return;
    }
    
    // Mark this ID as attempted
    analysisAttempts.current.add(transcriptionId);
    
    try {
      setIsAnalyzing(true);
      setAnalysisStatus('processing');
      
      // Get the current session to retrieve the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.access_token) {
        throw new Error('Authentication required for analysis');
      }
      
      // Verify the transcription exists before attempting analysis
      const { data: existingRecord, error: recordError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', transcriptionId)
        .single();
        
      if (recordError || !existingRecord) {
        console.error('Record not found before analysis API call:', recordError);
        throw new Error('The transcription record could not be found for analysis');
      }
      
      // Use the transcription text from the record if available
      const transcriptionText = existingRecord.transcription_text || transcriptionRecord?.transcriptionText;
      
      if (!transcriptionText) {
        console.error('No transcription text available for analysis');
        throw new Error('No transcription text available for analysis');
      }
      
      console.log('Sending analysis request for transcription:', transcriptionId);
      
      // Limit retries to prevent infinite loops
      return await retryOperation(async () => {
        const response = await fetch('/api/analyze-transcript', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcriptionId,
            transcriptionText,
            accessToken: session.access_token
          })
        });
        
        // Clone the response before attempting to read it
        const responseClone = response.clone();
        
        if (!response.ok) {
          let errorMessage = 'Failed to analyze transcription';
          
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
            console.error('Analysis error response:', errorData);
          } catch (jsonError) {
            try {
              // If JSON parsing fails, try to get the text
              const textError = await responseClone.text();
              errorMessage = textError || errorMessage;
              console.error('Analysis error text:', textError);
            } catch (textError) {
              console.error('Failed to read error response:', textError);
            }
          }
          
          throw new Error(errorMessage);
        }
        
        const analysisResponse = await response.json();
        console.log('Analysis response:', analysisResponse);
        
        // Update the transcription record with the analysis data
        if (analysisResponse.success && analysisResponse.analysis) {
          console.log('Updating transcription record with analysis data:', analysisResponse.analysis);
          
          // Create a dummy analysis data object if none exists
          if (!analysisResponse.analysis.sentiment) {
            console.log('No sentiment data in response, creating default');
            analysisResponse.analysis.sentiment = 'Neutral';
            analysisResponse.analysis.sentiment_explanation = 'No sentiment detected in the transcript.';
          }
          
          // Update the local state with the analysis data immediately
          setTranscriptionRecord(prev => {
            if (!prev) return prev;
            const updatedRecord = {
              ...prev,
              analysisStatus: 'completed' as const,
              analysisData: analysisResponse.analysis
            };
            
            // Automatically save the analysis data to the database
            console.log('Auto-saving analysis data to database...');
            // Use setTimeout to ensure state update completes first
            setTimeout(() => {
              saveAnalysisData(transcriptionId, analysisResponse.analysis)
                .then(success => {
                  if (success) {
                    console.log('Analysis data auto-saved successfully');
                    setUpdateMessage('Analysis data auto-saved successfully');
                  } else {
                    console.warn('Failed to auto-save analysis data');
                  }
                })
                .catch(saveError => {
                  console.error('Error auto-saving analysis data:', saveError);
                });
            }, 100);
            
            return updatedRecord;
          });
          
          // No need to fetch from database again since we're updating the state directly
          setIsAnalyzing(false);
          console.log('Transcription record updated with analysis data');
        } else {
          console.error('Analysis response missing success or analysis data:', analysisResponse);
          setIsAnalyzing(false);
          throw new Error('Invalid analysis response from server');
        }
        
        return analysisResponse;
      }, 2, 2000, 'Analysis request');
    } catch (error: any) {
      console.error('Analysis error:', error);
      setError(`Analysis failed: ${error.message}`);
      setIsAnalyzing(false);
      
      // Update the record to show the error
      if (transcriptionRecord) {
        setTranscriptionRecord({
          ...transcriptionRecord,
          analysisStatus: 'error' as const,
          error: error.message
        });
      }
      
      // Don't throw the error further to prevent cascading failures
      return null;
    }
  };

  // Function to manually trigger analysis
  const triggerAnalysis = () => {
    if (transcriptionRecord?.id) {
      setIsAnalyzing(true);
      setAnalysisStatus('processing');
      
      // Update the UI immediately to show analysis is in progress
      setTranscriptionRecord(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          analysisStatus: 'processing' as const
        };
      });
      
      // Request the analysis
      requestAnalysis(transcriptionRecord.id)
        .then(analysisResponse => {
          console.log('Analysis completed:', analysisResponse);
          
          // Auto-save the analysis data after manually triggered analysis
          if (analysisResponse && analysisResponse.analysis) {
            console.log('Auto-saving analysis data after manual trigger...');
            
            // Use a slight delay to ensure state updates have completed
            setTimeout(() => {
              saveAnalysisData(transcriptionRecord.id, analysisResponse.analysis)
                .then(success => {
                  if (success) {
                    console.log('Analysis data auto-saved successfully');
                    setUpdateMessage('Analysis data auto-saved successfully');
                  }
                })
                .catch(saveError => {
                  console.error('Error auto-saving analysis data:', saveError);
                });
            }, 100);
          }
        })
        .catch(error => {
          console.error('Error triggering analysis:', error);
          setIsAnalyzing(false);
          setAnalysisStatus('error');
        });
    }
  };

  const renderStatusBanner = () => {
    let statusMessage = '';
    let icon = null;
    let bgColor = '';
    let textColor = '';
    let borderColor = '';
    
    if (isAnalyzing) {
      statusMessage = 'Analyzing the interview content...';
      icon = <Sparkles className="w-5 h-5 mr-2" />;
      bgColor = 'bg-amber-50';
      textColor = 'text-amber-700';
      borderColor = 'border-amber-200';
    } else if (isSummarizing) {
      statusMessage = 'Generating summary...';
      icon = <FileText className="w-5 h-5 mr-2" />;
      bgColor = 'bg-blue-50';
      textColor = 'text-blue-700';
      borderColor = 'border-blue-200';
    } else if (transcriptionRecord?.summaryText && transcriptionRecord?.analysisData) {
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
      <div className="mb-8 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
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
                disabled={!transcriptionRecord?.summaryText}
                className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <ListTodo className="h-4 w-4 mr-2" />
                Summary
              </TabsTrigger>
              <TabsTrigger 
                value="analysis" 
                disabled={isAnalyzing ? false : !transcriptionRecord?.analysisData}
                className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <BarChart className="h-4 w-4 mr-2" />
                {isAnalyzing ? 'Analyzing...' : 'Analysis'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="transcription" className="pt-4">
              {!transcriptionRecord?.transcriptionText ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400" />
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
              {!transcriptionRecord?.summaryText ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400" />
                  <p>No summary available yet</p>
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
              {isAnalyzing ? (
                <div className="p-6 text-center text-amber-600">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-amber-500" />
                  <p className="font-medium">Analyzing interview content...</p>
                  <p className="text-sm text-amber-500 mt-2">This may take a minute or two.</p>
                </div>
              ) : !transcriptionRecord?.analysisData ? (
                <div className="p-6 text-center text-gray-500">
                  <FileQuestion className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p>No analysis available yet</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={triggerAnalysis}
                    className="mt-4"
                  >
                    <BarChart2 className="h-4 w-4 mr-2" />
                    Start Analysis
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4">
                    <div className="flex items-center mb-2">
                      <Heart className="h-5 w-5 mr-2 text-rose-500" />
                      <h3 className="text-lg font-medium">Customer Sentiment</h3>
                    </div>
                    
                    {/* Display sentiment with improved type safety */}
                    <div className="flex flex-col gap-2">
                      {/* Debug info - comment out in production */}
                      {/* <div className="text-xs text-gray-500 mb-1">
                        Raw sentiment data: {JSON.stringify(transcriptionRecord?.analysisData || {})}
                      </div> */}
                      
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

                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4">
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

                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4">
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
                            <h3 className="text-lg font-semibold">Topics</h3>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {transcriptionRecord.analysisData.topics.map((topicItem, index) => (
                              <Badge key={index} className="bg-blue-100 text-blue-800 hover:bg-blue-200">{topicItem.topic}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {Array.isArray(transcriptionRecord.analysisData.keyInsights) && transcriptionRecord.analysisData.keyInsights.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center space-x-2">
                            <KeyRound className="h-5 w-5 text-emerald-500" />
                            <h3 className="text-lg font-semibold">Key Insights</h3>
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

  const renderAnalysisTab = () => {
    if (isAnalyzing) {
      return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Analyzing transcript...</p>
        </div>
      );
    }
    
    if (!transcriptionRecord?.analysisData) {
      return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">No analysis available yet.</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={triggerAnalysis}
          >
            <BarChart2 className="h-4 w-4 mr-2" />
            Start Analysis
          </Button>
        </div>
      );
    }
    
    const { sentiment, sentiment_explanation, pain_points, feature_requests } = transcriptionRecord.analysisData;
    const otherData = transcriptionRecord.analysisData as any;
    const topics = Array.isArray(otherData.topics) ? otherData.topics : [];
    const keyInsights = Array.isArray(otherData.keyInsights) ? otherData.keyInsights : [];
    
    // Determine sentiment color
    let sentimentColor = 'bg-gray-200';
    let sentimentIcon = <CircleSlash className="h-5 w-5" />;
    
    if (sentiment && typeof sentiment === 'string') {
      const sentimentLower = sentiment.toLowerCase();
      if (sentimentLower.includes('positive')) {
        sentimentColor = 'bg-green-200';
        sentimentIcon = <SmilePlus className="h-5 w-5 text-green-600" />;
      } else if (sentimentLower.includes('negative')) {
        sentimentColor = 'bg-red-200';
        sentimentIcon = <Frown className="h-5 w-5 text-red-600" />;
      } else if (sentimentLower.includes('neutral')) {
        sentimentColor = 'bg-blue-200';
        sentimentIcon = <CircleDot className="h-5 w-5 text-blue-600" />;
      }
    }
    
    return (
      <div className="space-y-6 p-4">
        {/* Sentiment Section */}
        <div className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center space-x-2">
            <Heart className="h-5 w-5 text-red-500" />
            <h3 className="text-lg font-semibold">Customer Sentiment</h3>
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <div className={`${sentimentColor} p-2 rounded-full`}>
              {sentimentIcon}
            </div>
            <p className="text-sm">{sentiment_explanation || `The transcript has a ${sentiment || 'neutral'} sentiment.`}</p>
          </div>
        </div>
        
        {/* Pain Points Section */}
        <div className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold">Pain Points</h3>
          </div>
          {Array.isArray(pain_points) && pain_points.length > 0 ? (
            <ul className="space-y-2 mt-2">
              {pain_points.map((point, index) => (
                <li key={index} className="text-sm">
                  {typeof point === 'string' ? point : 
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
                    JSON.stringify(point))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No pain points identified.</p>
          )}
        </div>
        
        {/* Feature Requests Section */}
        <div className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center space-x-2">
            <Lightbulb className="h-5 w-5 text-purple-500" />
            <h3 className="text-lg font-semibold">Feature Requests</h3>
          </div>
          {Array.isArray(feature_requests) && feature_requests.length > 0 ? (
            <ul className="space-y-2">
              {feature_requests.map((feature, index) => (
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
        
        {/* Topics and Key Insights */}
        {(Array.isArray(topics) && topics.length > 0) || (Array.isArray(keyInsights) && keyInsights.length > 0) ? (
          <div className="border rounded-lg p-4 space-y-2">
            {Array.isArray(topics) && topics.length > 0 && (
              <div>
                <div className="flex items-center space-x-2">
                  <Hash className="h-5 w-5 text-blue-500" />
                  <h3 className="text-lg font-semibold">Topics</h3>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {topics.map((topicItem, index) => (
                    <Badge key={index} className="bg-blue-100 text-blue-800 hover:bg-blue-200">{topicItem.topic}</Badge>
                  ))}
                </div>
              </div>
            )}
            
            {Array.isArray(keyInsights) && keyInsights.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center space-x-2">
                  <KeyRound className="h-5 w-5 text-emerald-500" />
                  <h3 className="text-lg font-semibold">Key Insights</h3>
                </div>
                <ul className="space-y-1 mt-2">
                  {keyInsights.map((insightItem, index) => (
                    <li key={index} className="text-sm">{insightItem.insight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
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
        sentiment_explanation: 'No sentiment analysis available',
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
    const autoProcessTranscription = async () => {
      if (transcriptionRecord?.id && transcriptionRecord?.transcriptionText) {
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
            triggerAnalysis();
          } catch (error) {
            console.error('Auto-sentiment analysis failed:', error);
          }
        }
      }
    
    };
    
    autoProcessTranscription();
  }, [transcriptionRecord?.id, transcriptionRecord?.transcriptionText, generateSummaryForTranscription, requestAnalysis, supabase]);

  useEffect(() => {
    if (currentTranscriptionId) {
      checkTranscriptionStatus();
    }
    
    async function checkTranscriptionStatus() {
      try {
        if (!currentTranscriptionId) return;
        
        // Check authentication first
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.log('Authentication required for checking transcription status - user is not logged in');
          return; // Exit early without error if not authenticated
        }
        
        console.log('Checking transcription status for ID:', currentTranscriptionId);
        
        // Query the database for the latest status
        const { data: record, error } = await supabase
          .from('transcriptions')
          .select('*')
          .eq('id', currentTranscriptionId)
          .single();
          
        if (error) {
          console.error('Error fetching transcription:', error.message);
          return;
        }
        
        if (!record) {
          console.log('No transcription record found with ID:', currentTranscriptionId);
          return;
        }
        
        // Map the database record to our frontend format
        const mappedRecord = mapDbRecordToTranscriptionRecord(record);
        console.log('Updated transcription record:', {
          id: mappedRecord.id,
          status: mappedRecord.status,
          hasText: !!mappedRecord.transcriptionText
        });
        
        // Update state with the latest transcription data
        setTranscriptionRecord(mappedRecord);
        
        // If still processing, check again in a few seconds
        if (record.status === 'processing') {
          setTimeout(checkTranscriptionStatus, 5000);
        }
      } catch (err) {
        console.error('Error checking transcription status:', err);
      }
    }
  }, [currentTranscriptionId, supabase]);

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

  // Function to handle analysis results and save to database
  const saveAnalysisData = async (transcriptionId: string, analysisData: any) => {
    try {
      setLoadingState('saving-analysis');
      setErrorMessage(null);
      
      // Format the analysis data to ensure it has the correct structure
      const formattedData = {
        sentiment: analysisData.sentiment || 'neutral',
        sentiment_explanation: analysisData.sentiment_explanation || 'No explanation available',
        pain_points: Array.isArray(analysisData.pain_points) ? analysisData.pain_points : [],
        feature_requests: Array.isArray(analysisData.feature_requests) ? analysisData.feature_requests : [],
        // Adding topics and keyInsights with type safety
        topics: Array.isArray(analysisData.topics) ? analysisData.topics : [],
        keyInsights: Array.isArray(analysisData.keyInsights) ? analysisData.keyInsights : []
      };
      
      console.log('Saving analysis data to database:', {
        transcriptionId,
        dataPreview: JSON.stringify(formattedData).substring(0, 200)
      });
      
      // Get the session token
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      
      if (!accessToken) {
        throw new Error('No access token available');
      }
      
      // Use our utility function to update analysis data
      const responseClone = await fetch('/api/transcription/update-analysis', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          transcriptionId,
          analysisData: formattedData,
          accessToken
        }),
      });
      
      // Clone the response before reading
      const response = responseClone.clone();
      
      // First try JSON
      try {
        const data = await response.json();
        
        if (!response.ok) {
          console.error('API error details:', data);
          throw new Error(data.error || 'Failed to save analysis data');
        }
        
        console.log('Analysis data saved successfully:', data);
        setUpdateMessage('Analysis data saved successfully');
        
        // Update local state with the saved analysis
        setTranscriptionRecord(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            analysisData: {
              ...prev.analysisData,
              ...formattedData
            },
            analysisStatus: 'completed'
          };
        });
        
        return true;
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        
        // If JSON parsing fails, try text
        try {
          const textData = await responseClone.text();
          console.error('Text response:', textData);
          throw new Error(`Server response error: ${textData}`);
        } catch (textError) {
          console.error('Error reading text response:', textError);
          throw new Error('Failed to parse server response');
        }
      }
    } catch (error) {
      console.error('Error saving analysis data:', error);
      setErrorMessage(`Failed to save analysis data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    } finally {
      setLoadingState('idle');
    }
  };

  const processUploadedFile = async () => {
    if (!selectedFile || !user || !transcriptionRecord) return;
    
    try {
      setIsTranscribing(true);
      setTranscriptionProgress(0);
      setTranscriptionError(null);
      
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setTranscriptionProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 1000);
      
      console.log('Starting transcription for file:', transcriptionRecord.fileName);
      
      // Send the file to the transcription API
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('transcriptionId', transcriptionRecord.id);
      formData.append('fileName', selectedFile.name);
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      
      // Clone the response for potential error handling
      const responseClone = response.clone();
      
      if (!response.ok) {
        let errorMessage;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || `HTTP error ${response.status}`;
        } catch (jsonError) {
          try {
            errorMessage = await responseClone.text();
          } catch (textError) {
            errorMessage = `HTTP error ${response.status}`;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('Transcription completed:', data);
      
      // Update UI with transcription result
      setTranscriptionText(data.text);
      setTranscriptionStatus('completed');
      setTranscriptionProgress(100);
      clearInterval(progressInterval);
      
      // Analyze the transcription
      console.log('Starting analysis for transcription:', transcriptionRecord.id);
      
      // Use the new retry-enabled analysis function
      await analyzeTranscription(transcriptionRecord.id, data.text);
      
    } catch (error: any) {
      console.error('Transcription error:', error);
      setTranscriptionError(`Transcription failed: ${error.message}`);
      setTranscriptionStatus('error');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Function to handle analysis with timeout handling and retries
  const analyzeTranscription = async (transcriptionId: string, text: string) => {
    console.log(`Starting analysis for transcription ${transcriptionId}`);
    setAnalysisStatus('processing');
    setIsAnalyzing(true);
    
    try {
      // Maximum number of retries
      const MAX_RETRIES = 3;
      // Timeout for the analysis request (in milliseconds)
      const ANALYSIS_TIMEOUT = 120000; // 2 minutes
      
      let retryCount = 0;
      let success = false;
      
      while (retryCount < MAX_RETRIES && !success) {
        try {
          // Create an AbortController to handle timeouts
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT);
          
          console.log(`Analysis attempt ${retryCount + 1} for transcription ${transcriptionId}`);
          
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptionId,
              transcriptionText: text, // Pass the text directly to the API
            }),
            signal: controller.signal,
          });
          
          // Clear the timeout since the request completed
          clearTimeout(timeoutId);
          
          // Clone the response for potential error handling
          const responseClone = response.clone();
          
          if (!response.ok) {
            let errorMessage;
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || `HTTP error ${response.status}`;
            } catch (jsonError) {
              try {
                errorMessage = await responseClone.text();
              } catch (textError) {
                errorMessage = `HTTP error ${response.status}`;
              }
            }
            
            throw new Error(errorMessage);
          }
          
          const data = await response.json();
          console.log('Analysis completed successfully:', data);
          
          // Update the analysis data
          setAnalysisData(data.analysis);
          setAnalysisStatus('completed');
          success = true;
          
        } catch (error: any) {
          retryCount++;
          console.error(`Analysis attempt ${retryCount} failed:`, error);
          
          // Check if this was a timeout
          if (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('FUNCTION_INVOCATION_TIMEOUT')) {
            console.log('Analysis timed out, will retry');
          }
          
          // If we've exhausted all retries, mark as failed
          if (retryCount >= MAX_RETRIES) {
            console.error('All analysis attempts failed');
            setAnalysisStatus('error');
            setAnalysisError(`Analysis failed: ${error.message}`);
          } else {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      return success;
    } finally {
      setIsAnalyzing(false);
    }
  };

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
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
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
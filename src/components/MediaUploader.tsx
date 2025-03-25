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
  Lightbulb
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
import { TranscriptChat } from './TranscriptChat';

export function MediaUploader({ onComplete }: { onComplete?: (transcription: TranscriptionRecord) => void }) {
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
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);

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
          transcriptionId,
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
      // Check authentication first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('Authentication required for analysis - user is not logged in');
        return; // Exit early without error if not authenticated
      }
      
      console.log('Starting analysis with transcription ID:', transcriptionId);
      console.log('Using stored transcription ID:', currentTranscriptionId);
      
      // Use the stored ID if available, otherwise use the passed ID
      const finalTranscriptionId = currentTranscriptionId || transcriptionId;
      
      if (!finalTranscriptionId || typeof finalTranscriptionId !== 'string' || finalTranscriptionId.trim() === '') {
        console.error('Invalid transcription ID:', finalTranscriptionId);
        throw new Error('Invalid transcription ID. Please try uploading again.');
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
        
        const errorMessage = errorData.error || 'Failed to analyze transcript';
        
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
                disabled={!transcriptionRecord?.analysisData}
                className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <BarChart className="h-4 w-4 mr-2" />
                Analysis
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
                  <Button 
                    onClick={() => generateSummaryForTranscription(transcriptionRecord.id, transcriptionRecord.transcriptionText)}
                    disabled={isSummarizing}
                    className="flex items-center bg-indigo-600 hover:bg-indigo-700"
                  >
                    {isSummarizing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="mr-2 h-4 w-4" />
                        Generate Summary
                      </>
                    )}
                  </Button>
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
              {transcriptionRecord?.analysisData ? (
                <div className="space-y-6">
                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4">
                    <div className="flex items-center mb-2">
                      <Heart className="h-5 w-5 mr-2 text-rose-500" />
                      <h3 className="text-lg font-medium">Customer Sentiment</h3>
                    </div>
                    
                    {/* Display sentiment with improved type safety */}
                    <div className="flex flex-col gap-2">
                      {/* Debug info to see the actual raw sentiment value */}
                      <div className="text-xs text-gray-500 mb-1">
                        Raw sentiment data: {JSON.stringify(transcriptionRecord?.analysisData || {})}
                      </div>
                      
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
                    <ul className="space-y-2">
                      {transcriptionRecord.analysisData.pain_points && transcriptionRecord.analysisData.pain_points.map((point: { issue: string; description: string }, index: number) => (
                        <li key={index} className="flex items-start">
                          <div className="h-5 w-5 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                            {index + 1}
                          </div>
                          <p className="text-gray-700">{point.issue}: {point.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-white rounded-md p-6 border border-gray-100 space-y-4">
                    <div className="flex items-center mb-2">
                      <Lightbulb className="h-5 w-5 mr-2 text-indigo-500" />
                      <h3 className="text-lg font-medium">Feature Requests</h3>
                    </div>
                    <ul className="space-y-2">
                      {transcriptionRecord.analysisData.feature_requests && transcriptionRecord.analysisData.feature_requests.map((feature: { feature: string; description: string }, index: number) => (
                        <li key={index} className="flex items-start">
                          <div className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                            {index + 1}
                          </div>
                          <p className="text-gray-700">{feature.feature}: {feature.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 bg-white rounded-md border border-gray-100">
                  <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Analysis Data Not Available</h3>
                  <p className="text-gray-600 text-center max-w-md mb-4">
                    The analysis data is missing or hasn't been generated yet. Try clicking the "Analyze" button to generate insights for this transcription.
                  </p>
                  <Button 
                    onClick={() => transcriptionRecord && requestAnalysis(transcriptionRecord.id)}
                    disabled={isAnalyzing || !transcriptionRecord}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Analyze Transcription
                      </>
                    )}
                  </Button>
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
    };
    
    // More detailed debug for the chat component
    console.log('MediaUploader: Passing transcription record to chat:', {
      id: formattedRecord.id,
      type: typeof formattedRecord.id,
      idAsString: String(formattedRecord.id),
      fileName: formattedRecord.fileName,
      hasText: !!formattedRecord.transcriptionText?.length,
      textLength: formattedRecord.transcriptionText?.length
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
            await requestAnalysis(transcriptionRecord.id);
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
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
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
          <div className="mb-8 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
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
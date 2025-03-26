import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import fetch from 'node-fetch';

// Create a standard Supabase client without relying on cookies
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Helper function to wait for a specified time
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry a database operation with exponential backoff
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
  initialDelay = 500
): Promise<T> {
  let lastError;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await wait(delay);
      delay *= 1.5; // Exponential backoff
    }
  }
  
  throw lastError;
}

// Add a retry utility function at the top of the file after imports
async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000,
  factor: number = 2
): Promise<T> {
  let retries = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await operation();
    } catch (error: unknown) {
      retries++;
      
      // If we've reached max retries or it's not a network error, throw
      if (retries >= maxRetries || 
          !(error instanceof Error && 
            ((error as any).code === 'ECONNRESET' || 
             (error as any).code === 'ETIMEDOUT' || 
             error.message?.includes('network') || 
             error.message?.includes('connection')))) {
        throw error;
      }
      
      console.log(`Retry ${retries}/${maxRetries} after ${delay}ms due to: ${error instanceof Error ? error.message : String(error)}`);
      
      // Wait for the delay period
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increase delay for next retry
      delay *= factor;
    }
  }
}

// Rev.ai API configuration
const REV_AI_API_KEY = process.env.REV_AI_API_KEY;
const REV_AI_BASE_URL = 'https://api.rev.ai/speechtotext/v1';

// Whisper file size limit (25MB)
const WHISPER_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

// Increase timeout for transcription to 8 minutes (480000 ms) instead of 5 minutes
const TRANSCRIPTION_TIMEOUT = 480000; // 8 minutes

// Maximum size for direct transcription (10MB instead of 15MB to be safer)
const MAX_DIRECT_TRANSCRIPTION_SIZE = 10 * 1024 * 1024;

// Maximum file size allowed (400MB)
const MAX_FILE_SIZE = 400 * 1024 * 1024;

// Function to submit a transcription job to Rev.ai
async function submitRevAiJob(mediaUrl: string) {
  console.log('Submitting job to Rev.ai API');
  
  try {
    const response = await fetch(`${REV_AI_BASE_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REV_AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_config: {
          media_url: mediaUrl
        },
        metadata: 'InsightAI Transcription'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const job = await response.json();
    console.log('Rev.ai job submitted successfully:', job.id);
    return job;
  } catch (error) {
    console.error('Error submitting Rev.ai job:', error);
    throw error;
  }
}

// Function to get the status of a Rev.ai job
async function getRevAiJobStatus(jobId: string) {
  console.log(`Checking status of Rev.ai job: ${jobId}`);
  
  try {
    const response = await fetch(`${REV_AI_BASE_URL}/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REV_AI_API_KEY}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const jobStatus = await response.json();
    console.log(`Rev.ai job status: ${jobStatus.status}`);
    return jobStatus;
  } catch (error) {
    console.error('Error getting Rev.ai job status:', error);
    throw error;
  }
}

// Function to get the transcript from a completed Rev.ai job
async function getRevAiTranscript(jobId: string) {
  console.log(`Getting transcript for Rev.ai job: ${jobId}`);
  
  try {
    const response = await fetch(`${REV_AI_BASE_URL}/jobs/${jobId}/transcript`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REV_AI_API_KEY}`,
        'Accept': 'application/vnd.rev.transcript.v1.0+json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const transcript = await response.json();
    
    // Convert Rev.ai transcript format to plain text
    let plainText = '';
    if (transcript.monologues) {
      transcript.monologues.forEach((monologue: any) => {
        if (monologue.speaker && plainText.length > 0) {
          plainText += `\n\n[Speaker ${monologue.speaker}]\n`;
        }
        
        monologue.elements.forEach((element: any) => {
          if (element.type === 'text') {
            plainText += element.value + ' ';
          }
        });
      });
    }
    
    console.log('Rev.ai transcript retrieved successfully');
    return plainText.trim();
  } catch (error) {
    console.error('Error getting Rev.ai transcript:', error);
    throw error;
  }
}

// Function to poll for Rev.ai job completion
async function pollRevAiJobCompletion(jobId: string, maxAttempts = 60, delayMs = 10000) {
  console.log(`Polling for Rev.ai job completion: ${jobId}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const jobStatus = await getRevAiJobStatus(jobId);
      
      if (jobStatus.status === 'transcribed') {
        console.log(`Rev.ai job completed after ${attempt} attempts`);
        return await getRevAiTranscript(jobId);
      } else if (jobStatus.status === 'failed') {
        throw new Error(`Rev.ai job failed: ${jobStatus.failure_detail}`);
      }
      
      console.log(`Rev.ai job not ready yet (attempt ${attempt}/${maxAttempts}). Status: ${jobStatus.status}`);
      await wait(delayMs);
    } catch (error) {
      console.error(`Error polling Rev.ai job (attempt ${attempt}/${maxAttempts}):`, error);
      
      // If we've reached max retries, throw the error
      if (attempt >= maxAttempts) {
        throw error;
      }
      
      // Otherwise wait and try again
      await wait(delayMs);
    }
  }
  
  throw new Error(`Rev.ai job did not complete after ${maxAttempts} polling attempts`);
}

// Function to process large files in chunks
async function processLargeAudioFile(url: string, openai: OpenAI, transcriptionId: string) {
  console.log('Processing large audio file');
  
  try {
    // Fetch the file to determine its size and type
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch audio file: ${response.statusText}`);
    }
    
    // Get the content length from headers
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const contentType = response.headers.get('content-type') || '';
    
    console.log(`File size: ${contentLength} bytes, type: ${contentType}`);
    
    // Update the transcription record to indicate processing has started
    await supabase
      .from('transcriptions')
      .update({
        status: 'processing',
        transcription_text: 'Large file processing. This may take several minutes.',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    // Check if file is larger than Whisper's limit but smaller than our max file size
    if (contentLength > WHISPER_FILE_SIZE_LIMIT && contentLength <= MAX_FILE_SIZE) {
      console.log('File exceeds Whisper limit, using Rev.ai for transcription');
      
      // Update status to indicate we're using Rev.ai
      await supabase
        .from('transcriptions')
        .update({
          status: 'processing',
          transcription_text: 'Using Rev.ai for transcription. This may take several minutes.',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
      
      // Check if Rev.ai API key is configured
      if (!REV_AI_API_KEY) {
        throw new Error('Rev.ai API key not configured. Please set the REV_AI_API_KEY environment variable.');
      }
      
      // Start a background process to handle the Rev.ai transcription
      // This won't block the API response
      (async () => {
        try {
          console.log('Starting background processing with Rev.ai');
          
          // Submit job to Rev.ai
          const job = await submitRevAiJob(url);
          
          // Update the database with the Rev.ai job ID
          await supabase
            .from('transcriptions')
            .update({
              status: 'processing',
              transcription_text: `Rev.ai transcription in progress. Job ID: ${job.id}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          // Poll for job completion
          const transcriptionText = await pollRevAiJobCompletion(job.id);
          
          // Update the database with the complete transcription
          await supabase
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: transcriptionText,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          console.log('Rev.ai transcription completed and saved to database');
        } catch (backgroundError: unknown) {
          console.error('Background Rev.ai transcription process failed:', backgroundError);
          
          // Update the database with the error
          await supabase
            .from('transcriptions')
            .update({
              status: 'error',
              error: `Rev.ai processing failed: ${backgroundError instanceof Error ? backgroundError.message : String(backgroundError)}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        }
      })().catch(error => {
        console.error('Unhandled error in Rev.ai background process:', error);
      });
      
      // Return a message indicating Rev.ai is being used
      return "Large file detected. Using Rev.ai for transcription. This may take several minutes.";
    }
    
    // For files under Whisper's limit or if Rev.ai is not configured, use the original chunked approach
    console.log('Using original chunked approach with Whisper');
    
    // Get a buffer of the first part of the file (up to 5MB)
    const buffer = await response.arrayBuffer();
    const partialBuffer = buffer.slice(0, Math.min(buffer.byteLength, 5 * 1024 * 1024));
    const partialFile = new File([partialBuffer], "partial_audio.mp3", { type: contentType });
    
    // Define the expected response type
    interface TranscriptionResponse {
      text: string;
    }
    
    // Transcribe the partial file with retries
    let partialTranscription;
    try {
      partialTranscription = await retryWithExponentialBackoff(
        async () => {
          return await openai.audio.transcriptions.create({
            file: partialFile,
            model: 'whisper-1',
            response_format: 'text'
          });
        },
        3,  // 3 retries
        2000, // Start with 2 second delay
        2  // Double the delay each time
      );
    } catch (transcriptionError: unknown) {
      console.error('Error transcribing partial file:', transcriptionError);
      throw new Error(`Failed to transcribe partial file: ${transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError)}`);
    }
    
    // Get the transcription text (handling both string and object responses)
    let transcriptionText: string;
    if (typeof partialTranscription === 'string') {
      transcriptionText = partialTranscription;
    } else if (typeof partialTranscription === 'object' && partialTranscription !== null && 'text' in partialTranscription) {
      transcriptionText = (partialTranscription as TranscriptionResponse).text;
    } else {
      // Fallback if we get an unexpected response format
      transcriptionText = JSON.stringify(partialTranscription);
    }
    
    // Update the transcription with the partial result
    await supabase
      .from('transcriptions')
      .update({
        status: 'partial',
        transcription_text: transcriptionText + "\n\n[Note: This is a partial transcription of a large file. The full transcription is being processed and will be available soon.]",
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    // Start a background process to handle the full transcription
    // This won't block the API response
    (async () => {
      try {
        console.log('Starting background processing for full transcription');
        
        // Process the file in chunks if it's very large
        if (contentLength > MAX_DIRECT_TRANSCRIPTION_SIZE) { // If larger than our direct transcription limit
          console.log('File is very large, processing in multiple chunks');
          
          // For extremely large files, use larger chunks to reduce the number of API calls
          let chunkSize = 5 * 1024 * 1024; // Default 5MB chunks
          
          // Adjust chunk size based on file size to keep number of chunks manageable
          if (contentLength > 100 * 1024 * 1024) { // > 100MB
            chunkSize = 10 * 1024 * 1024; // 10MB chunks
          }
          if (contentLength > 200 * 1024 * 1024) { // > 200MB
            chunkSize = 20 * 1024 * 1024; // 20MB chunks
          }
          
          const numChunks = Math.ceil(contentLength / chunkSize);
          const chunks: string[] = [];
          
          // Process each chunk with retries
          for (let i = 0; i < numChunks; i++) {
            console.log(`Processing chunk ${i+1} of ${numChunks}`);
            
            try {
              // Fetch just this chunk of the file
              const chunkStart = i * chunkSize;
              const chunkEnd = Math.min((i + 1) * chunkSize - 1, contentLength - 1);
              
              const chunkResponse = await fetch(url, {
                headers: {
                  Range: `bytes=${chunkStart}-${chunkEnd}`
                }
              });
              
              if (!chunkResponse.ok) {
                console.error(`Failed to fetch chunk ${i+1}: ${chunkResponse.statusText}`);
                continue;
              }
              
              const chunkBuffer = await chunkResponse.arrayBuffer();
              const chunkFile = new File([chunkBuffer], `chunk_${i+1}.mp3`, { type: contentType });
              
              // Transcribe this chunk
              const chunkTranscription = await retryWithExponentialBackoff(
                async () => {
                  return await openai.audio.transcriptions.create({
                    file: chunkFile,
                    model: 'whisper-1',
                    response_format: 'text'
                  });
                },
                3,  // 3 retries
                2000, // Start with 2 second delay
                2  // Double the delay each time
              );
              
              // Extract the text
              let chunkText: string;
              if (typeof chunkTranscription === 'string') {
                chunkText = chunkTranscription;
              } else if (typeof chunkTranscription === 'object' && chunkTranscription !== null && 'text' in chunkTranscription) {
                chunkText = (chunkTranscription as TranscriptionResponse).text;
              } else {
                chunkText = JSON.stringify(chunkTranscription);
              }
              
              chunks.push(chunkText);
              
              // Update the database with progress
              await supabase
                .from('transcriptions')
                .update({
                  status: 'processing',
                  transcription_text: transcriptionText + `\n\n[Processing: ${i+1}/${numChunks} chunks complete]`,
                  updated_at: new Date().toISOString()
                })
                .eq('id', transcriptionId);
                
            } catch (chunkError: unknown) {
              console.error(`Error processing chunk ${i+1}:`, chunkError);
              // Continue with other chunks even if one fails
            }
          }
          
          // Combine all chunks
          const fullTranscription = chunks.join(' ');
          
          // Update the database with the complete transcription
          await supabase
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: fullTranscription,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          console.log('Full transcription completed and saved to database');
        } else {
          // For moderately large files, process the whole file at once
          console.log('Processing full file in one go');
          
          // Fetch the full file again
          const fullResponse = await fetch(url);
          const fullBuffer = await fullResponse.arrayBuffer();
          const fullFile = new File([fullBuffer], "full_audio.mp3", { type: contentType });
          
          // Transcribe the full file
          const fullTranscription = await retryWithExponentialBackoff(
            async () => {
              return await openai.audio.transcriptions.create({
                file: fullFile,
                model: 'whisper-1',
                response_format: 'text'
              });
            },
            3,  // 3 retries
            2000, // Start with 2 second delay
            2  // Double the delay each time
          );
          
          // Extract the text
          let fullText: string;
          if (typeof fullTranscription === 'string') {
            fullText = fullTranscription;
          } else if (typeof fullTranscription === 'object' && fullTranscription !== null && 'text' in fullTranscription) {
            fullText = (fullTranscription as TranscriptionResponse).text;
          } else {
            fullText = JSON.stringify(fullTranscription);
          }
          
          // Update the database with the complete transcription
          await supabase
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: fullText,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          console.log('Full transcription completed and saved to database');
        }
      } catch (backgroundError: unknown) {
        console.error('Background transcription process failed:', backgroundError);
        
        // Update the database with the error
        await supabase
          .from('transcriptions')
          .update({
            status: 'error',
            error: `Background processing failed: ${backgroundError instanceof Error ? backgroundError.message : String(backgroundError)}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
      }
    })().catch(error => {
      console.error('Unhandled error in background process:', error);
    });
    
    // Return the partial transcription text
    return transcriptionText + "\n\n[Note: This is a partial transcription. The full transcription is being processed.]";
  } catch (error: unknown) {
    console.error('Error in background transcription process:', error);
    
    // Update the status with the error
    await supabase
      .from('transcriptions')
      .update({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body with error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError: unknown) {
      console.error('Failed to parse request body as JSON:', parseError);
      return NextResponse.json({ 
        error: 'Invalid JSON in request body',
        details: 'Please ensure the request body is valid JSON'
      }, { status: 400 });
    }
    
    const { transcriptionId, mediaUrl, accessToken, record } = body;
    
    // Basic validation with detailed error messages
    if (!transcriptionId) {
      console.error('Missing required field: transcriptionId');
      return NextResponse.json(
        { error: 'Missing required field: transcriptionId' }, 
        { status: 400 }
      );
    }
    
    if (!mediaUrl) {
      console.error('Missing required field: mediaUrl');
      return NextResponse.json(
        { error: 'Missing required field: mediaUrl' }, 
        { status: 400 }
      );
    }
    
    // Check for authentication token
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json(
        { error: 'Authentication required. Please sign in and try again.' }, 
        { status: 401 }
      );
    }
    
    // Verify the token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { error: 'Authentication failed. Please sign in again.' }, 
        { status: 401 }
      );
    }
    
    console.log(`Processing transcription for user: ${user.email} (ID: ${user.id})`);
    
    // If record is provided directly from the client, use it
    let transcriptionData;
    if (record && record.id === transcriptionId && record.user_id === user.id) {
      console.log('Using record provided by client:', record.id);
      transcriptionData = record;
    } else {
      // Otherwise check if transcription belongs to the authenticated user
      console.log('Looking for transcription with ID:', transcriptionId);
      
      // Use retry mechanism to find the transcription record
      try {
        transcriptionData = await retryOperation(async () => {
          const { data, error } = await supabase
            .from('transcriptions')
            .select('id, user_id, status, media_path')
            .eq('id', transcriptionId)
            .single();
            
          if (error) {
            console.log(`Retry query error: ${error.message}`);
            throw error;
          }
          
          if (!data) {
            throw new Error('Transcription record not found');
          }
          
          return data;
        }, 5, 1000); // 5 retries with a 1 second initial delay
        
        console.log('Successfully found transcription record after retries:', transcriptionData);
      } catch (retryError: unknown) {
        console.error('All retry attempts failed to find transcription record:', retryError);
        
        // Last attempt to find any recent transcriptions for this user
        const { data: userTranscriptions } = await supabase
          .from('transcriptions')
          .select('id, status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);
          
        console.log('Recent transcriptions for user:', userTranscriptions || []);
        
        // Check if our transcription might be in this list but with a different ID
        const matchingTranscription = userTranscriptions?.find(t => {
          // Check if creation time is within the last 5 minutes
          const createdAt = new Date(t.created_at);
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          return createdAt > fiveMinutesAgo;
        });
        
        if (matchingTranscription) {
          console.log('Found a recent transcription that might match:', matchingTranscription);
          // Make sure we have a compatible structure with necessary fields
          transcriptionData = {
            id: matchingTranscription.id,
            user_id: user.id, // We know this belongs to the current user
            status: matchingTranscription.status,
            media_path: mediaUrl.split('/').pop() || '' // Use the media URL from the request
          };
        } else {
          return NextResponse.json(
            { error: 'Transcription record not found after multiple attempts. Please try uploading the file again.' },
            { status: 404 }
          );
        }
      }
    }
    
    // Now check ownership
    if (transcriptionData.user_id !== user.id) {
      console.error(`Unauthorized: User ${user.id} attempted to access transcription owned by ${transcriptionData.user_id}`);
      return NextResponse.json(
        { error: 'You do not have permission to access this transcription' },
        { status: 403 }
      );
    }
    
    // Check if OpenAI API key is set
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey || openaiApiKey === 'your-openai-api-key') {
      console.error('OpenAI API key not configured correctly');
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set up your API key.' }, 
        { status: 500 }
      );
    }
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    
    // Update transcription status to processing - use retry mechanism here too
    await retryOperation(async () => {
      const { error: updateError } = await supabase
        .from('transcriptions')
        .update({ status: 'processing' })
        .eq('id', transcriptionData.id);
      
      if (updateError) {
        console.error('Error updating transcription status:', updateError);
        throw updateError;
      }
    });
    
    // Get media file name from path or URL
    let mediaFileName = '';
    
    // Try to extract from the media URL first
    if (mediaUrl) {
      mediaFileName = mediaUrl.split('/').pop() || '';
    }
    
    // If that didn't work and we have media_path in the transcription record, try that
    if (!mediaFileName && transcriptionData.media_path) {
      mediaFileName = transcriptionData.media_path.split('/').pop() || '';
    }
    
    // If we still don't have a file name, use a default
    if (!mediaFileName) {
      mediaFileName = 'audio.mp3';
    }
    
    console.log('Media URL provided:', mediaUrl);
    console.log('Extracted media filename:', mediaFileName);
    
    // Get presigned URL for media access - with retry
    let presignedUrlData;
    try {
      // First check if the bucket exists, create if not
      console.log('Checking if storage bucket exists...');
      const { data: buckets } = await supabase.storage.listBuckets();
      const mediaFilesBucket = buckets?.find(b => b.name === 'media-files');
      
      if (!mediaFilesBucket) {
        console.log('Media bucket not found, creating it...');
        try {
          await supabase.storage.createBucket('media-files', {
            public: true,
            fileSizeLimit: 419430400, // 400MB in bytes
            allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'video/mp4']
          });
          console.log('Successfully created media bucket');
        } catch (bucketError: unknown) {
          console.error('Error creating media bucket:', bucketError);
          // Continue anyway, maybe the bucket exists but we don't have permission to list it
        }
      }
      
      // Properly extract file path
      let filePath = mediaUrl;
      
      // Try to extract file path from URL if it's a full URL
      if (mediaUrl.includes('http')) {
        // Extract the path after /object/public/media-files/
        const matches = mediaUrl.match(/\/media-files\/(.+)/);
        if (matches && matches[1]) {
          filePath = matches[1];
          console.log('Extracted file path from URL:', filePath);
        } else {
          // Fall back to the filename
          filePath = mediaFileName;
          console.log('Using filename as path:', filePath);
        }
      }
      
      console.log('Attempting to get signed URL for:', filePath);
      
      presignedUrlData = await retryOperation(async () => {
        const { data, error } = await supabase.storage
          .from('media-files')
          .createSignedUrl(filePath, 3600);
        
        if (error || !data || !data.signedUrl) {
          console.error('Failed to generate presigned URL:', error);
          
          // Try alternate path formats if the first attempt fails
          if (error && filePath.includes('/')) {
            // Try without user ID prefix
            const pathWithoutPrefix = filePath.split('/').pop();
            console.log('Trying alternate path without prefix:', pathWithoutPrefix);
            
            const altResult = await supabase.storage
              .from('media-files')
              .createSignedUrl(pathWithoutPrefix || '', 3600);
              
            if (!altResult.error && altResult.data?.signedUrl) {
              return altResult.data;
            }
          }
          
          throw error || new Error('No signed URL returned');
        }
        
        return data;
      }, 3, 1000); // 3 retries with a 1 second initial delay
      
      console.log('Successfully generated signed URL:', presignedUrlData.signedUrl.substring(0, 100) + '...');
    } catch (urlError: unknown) {
      console.error('Failed to generate presigned URL after retries:', urlError);
      
      // Check available buckets
      const { data: buckets } = await supabase.storage.listBuckets();
      console.log('Available buckets:', buckets);
      
      await supabase
        .from('transcriptions')
        .update({ 
          status: 'error', 
          error: 'Could not access media file after multiple attempts' 
        })
        .eq('id', transcriptionData.id);
      
      return NextResponse.json({ 
        success: false,
        error: 'Failed to access media file after multiple attempts',
        details: JSON.stringify({ error: 'Failed to access media file after multiple attempts' })
      }, { status: 500 });
    }
    
    // Check if the file is too large for direct transcription BEFORE attempting to process it
    try {
      console.log('Checking file size before transcription...');
      const fileResponse = await fetch(presignedUrlData.signedUrl, { method: 'HEAD' });
      const fileSize = parseInt(fileResponse.headers.get('content-length') || '0');
      
      console.log(`File size: ${fileSize} bytes, Whisper limit: ${WHISPER_FILE_SIZE_LIMIT} bytes, Max allowed: ${MAX_FILE_SIZE} bytes`);
      
      // Check if the file exceeds our maximum allowed size
      if (fileSize > MAX_FILE_SIZE) {
        console.log(`File is too large (${fileSize} bytes), exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`);
        
        await supabase
          .from('transcriptions')
          .update({ 
            status: 'error', 
            error: `File size (${(fileSize / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)}MB` 
          })
          .eq('id', transcriptionData.id);
        
        return NextResponse.json({
          success: false,
          error: 'File too large',
          details: `The file size of ${(fileSize / (1024 * 1024)).toFixed(2)}MB exceeds the maximum allowed size of ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)}MB.`,
        }, { status: 413 }); // 413 Payload Too Large
      }
      
      // Check if Rev.ai API key is set for large files
      const revAiApiKey = process.env.REV_AI_API_KEY;
      if (!revAiApiKey && fileSize > WHISPER_FILE_SIZE_LIMIT) {
        console.log('Warning: Rev.ai API key not configured. Large files may fail to transcribe.');
      }
      
      // For files larger than Whisper's limit but within our max limit, use Rev.ai
      if (fileSize > WHISPER_FILE_SIZE_LIMIT) {
        console.log(`File is too large for Whisper (${fileSize} bytes), using Rev.ai approach`);
        
        // Use the processLargeAudioFile function which now handles Rev.ai integration
        const partialTranscription = await processLargeAudioFile(presignedUrlData.signedUrl, openai, transcriptionData.id);
        
        return NextResponse.json({
          success: true,
          transcriptionId: transcriptionData.id,
          text: partialTranscription,
          isPartial: true,
          message: "Large file detected. Using Rev.ai for transcription. This may take several minutes."
        });
      }
    } catch (sizeCheckError: unknown) {
      console.error('Error checking file size:', sizeCheckError);
      // Continue with normal processing if we can't check the size
    }
    
    // Transcribe audio with timeout handling
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT);
      
      try {
        // Fetch the file and prepare it for OpenAI
        console.log('Attempting to download audio file from signed URL...');
        
        // Use retry logic for fetching the audio file
        const response = await retryWithExponentialBackoff(
          async () => {
            const fetchResponse = await fetch(presignedUrlData.signedUrl);
            if (!fetchResponse.ok) {
              throw new Error(`Failed to fetch audio file: ${fetchResponse.status} ${fetchResponse.statusText}`);
            }
            return fetchResponse;
          },
          3,  // 3 retries
          2000, // Start with 2 second delay
          2  // Double the delay each time
        );
        
        // Get the audio data as an ArrayBuffer instead of Blob to avoid type issues
        const audioBuffer = await response.arrayBuffer();
        
        // Create a File object from the ArrayBuffer
        const audioFile = new File(
          [audioBuffer], 
          mediaFileName || 'audio.mp3', 
          { type: response.headers.get('content-type') || 'audio/mpeg' }
        );
        
        console.log('Sending audio file to OpenAI for transcription...');
        
        // Use retry logic for the OpenAI API call
        const transcription = await retryWithExponentialBackoff(
          async () => {
            return await openai.audio.transcriptions.create({
              file: audioFile,
              model: 'whisper-1',
            });
          },
          3,  // 3 retries
          2000, // Start with 2 second delay
          2  // Double the delay each time
        );
        
        clearTimeout(timeoutId); // Clear the timeout if the request completes successfully
        
        // Update transcription record with results - with retry
        try {
          console.log('Attempting to update transcription record with status: completed');
          console.log('Transcription ID:', transcriptionData.id);
          console.log('Transcript length:', transcription.text.length, 'characters');
          
          await retryOperation(async () => {
            console.log('Executing database update...');
            const updateResult = await supabase
              .from('transcriptions')
              .update({
                status: 'completed',
                transcription_text: transcription.text,
                updated_at: new Date().toISOString()
              })
              .eq('id', transcriptionData.id)
              .select();
            
            if (updateResult.error) {
              console.error('Error updating transcription results:', updateResult.error);
              throw updateResult.error;
            }
            
            console.log('Update successful:', updateResult.data);
            
            // Double-check the update
            const verifyResult = await supabase
              .from('transcriptions')
              .select('id, status, transcription_text')
              .eq('id', transcriptionData.id)
              .single();
              
            console.log('Verified record after update:', verifyResult.data);
            
            return updateResult;
          }, 3, 1000);
          
          console.log('Successfully updated transcription status to completed');
        } catch (updateError: unknown) {
          console.error('All attempts to update transcription record failed:', updateError);
          
          // Even though we failed to update the record, we can still return the transcription text
          return NextResponse.json({
            success: true,
            transcriptionId: transcriptionData.id,
            text: transcription.text,
            warning: 'Transcription was generated but failed to update the database record',
          });
        }
        
        return NextResponse.json({
          success: true,
          transcriptionId: transcriptionData.id,
          text: transcription.text,
        });
      } catch (error: unknown) {
        clearTimeout(timeoutId); // Clear the timeout
        
        // Handle different types of errors
        let errorMessage = 'Transcription failed';
        let statusCode = 500;
        
        if (error instanceof Error && (error.name === 'AbortError' || (error as any).code === 'ETIMEDOUT')) {
          console.error('Request timed out after 5 minutes');
          errorMessage = 'The transcription process timed out. Your file may be too large or the server is busy. Please try again later or use a smaller file.';
          statusCode = 504; // Gateway Timeout
        } else if (error instanceof Error && (error as any).code === 'ECONNRESET') {
          console.error('Connection reset error:', error);
          errorMessage = 'Network connection error while transcribing';
          statusCode = 503; // Service Unavailable
        } else if (error instanceof Error && (error.message?.includes('network') || error.message?.includes('connection'))) {
          console.error('Network error:', error);
          errorMessage = 'Network error while transcribing';
          statusCode = 503; // Service Unavailable
        } else {
          console.error('OpenAI transcription error:', error);
        }
        
        // Update transcription record with error
        try {
          await supabase
            .from('transcriptions')
            .update({
              status: 'error',
              error: errorMessage,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionData.id);
        } catch (updateError: unknown) {
          console.error('Error updating transcription status to error:', updateError);
        }
        
        // Ensure the error response is valid JSON
        return NextResponse.json({ 
          success: false,
          error: 'Transcription failed',
          details: errorMessage
        }, { status: statusCode });
      }
    } catch (openaiError: unknown) {
      console.error('OpenAI transcription error:', openaiError);
      
      let errorMessage = openaiError instanceof Error ? openaiError.message : String(openaiError);
      
      // Check for API key errors
      if (
        errorMessage.includes('API key') || 
        errorMessage.includes('authentication') ||
        errorMessage.includes('401')
      ) {
        errorMessage = 'Invalid OpenAI API key. Please check your API key configuration.';
      }
      
      // Check for file format errors
      if (
        errorMessage.includes('format') || 
        errorMessage.includes('decode') ||
        errorMessage.includes('unsupported')
      ) {
        errorMessage = 'Unsupported audio format. Please upload an MP3 or MP4 file.';
      }
      
      // Update transcription record with error
      try {
        await supabase
          .from('transcriptions')
          .update({
            status: 'error',
            error: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionData.id);
      } catch (updateError: unknown) {
        console.error('Error updating transcription status to error:', updateError);
      }
      
      // Ensure the error response is valid JSON
      return NextResponse.json({ 
        success: false,
        error: 'Transcription failed',
        details: errorMessage
      }, { status: 500 });
    }
  } catch (error: unknown) {
    console.error('Unexpected error in transcribe API:', error);
    
    // Ensure the error response is valid JSON
    return NextResponse.json({ 
      success: false,
      error: 'An unexpected error occurred',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Add a global error handler to catch any unexpected errors and format them as JSON
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Limit request body size to 10MB
    },
    externalResolver: true, // Ensures all errors are properly formatted as JSON
  },
};
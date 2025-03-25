export const fetchCache = "force-no-store";

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

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

// Increase timeout for transcription to 8 minutes (480000 ms) instead of 5 minutes
const TRANSCRIPTION_TIMEOUT = 480000; // 8 minutes

// Maximum size for direct transcription (10MB instead of 15MB to be safer)
const MAX_DIRECT_TRANSCRIPTION_SIZE = 10 * 1024 * 1024;

// Function to process large files in chunks
async function processLargeAudioFile(url: string, openai: OpenAI, transcriptionId: string) {
  console.log('Processing large audio file in chunks');
  
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
    
    // For very large files, we'll use a different approach
    // We'll process the first 5 minutes of the audio to get a quick result
    console.log('Starting partial transcription process');
    
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
        if (contentLength > 20 * 1024 * 1024) { // If larger than 20MB
          console.log('File is very large, processing in multiple chunks');
          
          // Create chunks of approximately 5MB each
          const chunkSize = 5 * 1024 * 1024;
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
            fileSizeLimit: 26214400, // 25MB in bytes
            allowedMimeTypes: ['audio/mpeg', 'audio/mp3']
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
      
      console.log(`File size: ${fileSize} bytes, Max allowed: ${MAX_DIRECT_TRANSCRIPTION_SIZE} bytes`);
      
      if (fileSize > MAX_DIRECT_TRANSCRIPTION_SIZE) {
        console.log(`File is too large for direct transcription (${fileSize} bytes), using chunked approach`);
        
        // Use the processLargeAudioFile function to handle large files
        const partialTranscription = await processLargeAudioFile(presignedUrlData.signedUrl, openai, transcriptionData.id);
        
        return NextResponse.json({
          success: true,
          transcriptionId: transcriptionData.id,
          text: partialTranscription,
          isPartial: true,
          message: "Large file detected. A partial transcription has been generated. The full transcription is being processed in the background."
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
            const fetchResponse = await fetch(presignedUrlData.signedUrl, { signal: controller.signal });
            if (!fetchResponse.ok) {
              throw new Error(`Failed to fetch audio file: ${fetchResponse.status} ${fetchResponse.statusText}`);
            }
            return fetchResponse;
          },
          3,  // 3 retries
          2000, // Start with 2 second delay
          2  // Double the delay each time
        );
        
        const audioBlob = await response.blob();
        
        // Create a File object from the Blob
        const audioFile = new File(
          [audioBlob], 
          mediaFileName || 'audio.mp3', 
          { type: audioBlob.type || 'audio/mpeg' }
        );
        
        console.log('Sending audio file to OpenAI for transcription...');
        
        // Use retry logic for the OpenAI API call
        const transcription = await retryWithExponentialBackoff(
          async () => {
            return await openai.audio.transcriptions.create({
              file: audioFile,
              model: 'whisper-1',
            }, { signal: controller.signal });
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
      sizeLimit: '50mb',
    },
    externalResolver: true, // This tells Next.js that this route will handle its own errors
  },
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
  maxDuration: 600, // Increase maximum duration to 10 minutes (in seconds)
};
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

export async function POST(request: NextRequest) {
  try {
    // Parse request body with error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
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
      } catch (retryError: any) {
        console.error('All retry attempts failed to find transcription record:', retryError.message);
        
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
        } catch (bucketError) {
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
    } catch (urlError) {
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
      
      return NextResponse.json(
        { error: 'Failed to access media file after multiple attempts' }, 
        { status: 500 }
      );
    }
    
    // Transcribe audio with timeout handling
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout for audio processing
      
      try {
        // Fetch the file and prepare it for OpenAI
        const audioResponse = await fetch(presignedUrlData.signedUrl, { signal: controller.signal });
        if (!audioResponse.ok) {
          throw new Error(`Failed to fetch audio file: ${audioResponse.status} ${audioResponse.statusText}`);
        }
        
        const audioBlob = await audioResponse.blob();
        
        // Create a File object from the Blob
        const audioFile = new File(
          [audioBlob], 
          mediaFileName || 'audio.mp3', 
          { type: audioBlob.type || 'audio/mpeg' }
        );
        
        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
        }, { signal: controller.signal });
        
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
        } catch (updateError) {
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
      } catch (error: any) {
        clearTimeout(timeoutId); // Clear the timeout
        
        if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
          console.error('Request timed out after 3 minutes');
          
          // Update status to error
          await supabase
            .from('transcriptions')
            .update({
              status: 'error',
              error: 'Transcription process timed out',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionData.id);
            
          return NextResponse.json({ 
            error: 'The transcription process timed out',
            details: 'The file may be too large or the service is currently experiencing high load. Please try again later or with a shorter audio file.'
          }, { status: 504 }); // Gateway Timeout
        }
        
        throw error; // Re-throw the error to be handled by the outer catch block
      }
    } catch (openaiError: any) {
      console.error('OpenAI transcription error:', openaiError);
      
      let errorMessage = openaiError.message || 'Error transcribing audio';
      
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
      } catch (updateError) {
        console.error('Error updating transcription status to error:', updateError);
      }
      
      return NextResponse.json({ 
        error: 'Transcription failed',
        details: errorMessage
      }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('Unexpected error in transcribe API:', error);
    
    return NextResponse.json({ 
      error: 'An unexpected error occurred',
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}

// Configure response options
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
};
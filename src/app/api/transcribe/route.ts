import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import fetch from 'node-fetch';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if required environment variables are set
if (!supabaseUrl) {
  console.error('NEXT_PUBLIC_SUPABASE_URL is not set');
}

if (!serviceRoleKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY is not set - falling back to anon key');
}

if (!anonKey && !serviceRoleKey) {
  console.error('Neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY is set');
}

// Declare Supabase client variables but don't initialize them yet
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (supabaseUrl && (serviceRoleKey || anonKey)) {
  try {
    // Create Supabase admin client with service role key for bypassing RLS
    supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey || anonKey || ''
    );
    
    // Log which keys we're using (without exposing the actual keys)
    console.log(`Transcribe API: Using ${serviceRoleKey ? 'service role' : (anonKey ? 'anon' : 'missing')} key for admin client`);
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabaseAdmin = null;
  }
}

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
  let lastError: any;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Operation failed on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`);
      lastError = error;
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= factor; // Exponential backoff
      }
    }
  }
  
  console.error(`All ${maxRetries} retry attempts failed:`, lastError);
  throw lastError;
}

// Rev.ai API configuration
const REV_AI_API_KEY = typeof window === 'undefined' ? process.env.REV_AI_API_KEY || '' : '';
const REV_AI_BASE_URL = 'https://api.rev.ai/speechtotext/v1';

// Log if Rev.ai API key is missing or invalid
if (!REV_AI_API_KEY) {
  console.error('REV_AI_API_KEY is not set. Transcription will fail.');
} else if (!REV_AI_API_KEY.match(/^[a-zA-Z0-9_-]{20,}$/)) {
  console.error('REV_AI_API_KEY appears to be in an invalid format. It should be a string of at least 20 alphanumeric characters, underscores, or hyphens.');
}

// Maximum file size allowed (400MB)
const MAX_FILE_SIZE = 400 * 1024 * 1024;

// Increase timeout for transcription to 8 minutes (480000 ms)
const TRANSCRIPTION_TIMEOUT = 480000; // 8 minutes

// Function to submit a transcription job to Rev.ai
async function submitRevAiJob(mediaUrl: string) {
  console.log('Submitting job to Rev.ai API');
  
  try {
    // Construct the webhook URL based on the deployment URL or localhost for development
    let baseUrl = 'http://localhost:3000'; // Default for local development
    
    // First check for a custom Vercel URL (most reliable)
    if (process.env.NEXT_PUBLIC_VERCEL_URL) {
      baseUrl = `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
      console.log('Using custom Vercel URL for webhook:', baseUrl);
    }
    // In production on Vercel
    else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
      console.log('Using Vercel URL for webhook:', baseUrl);
    } 
    // If you've set a custom app URL
    else if (process.env.NEXT_PUBLIC_APP_URL) {
      baseUrl = process.env.NEXT_PUBLIC_APP_URL;
      console.log('Using custom app URL for webhook:', baseUrl);
    }
    // For Vercel preview deployments
    else if (process.env.VERCEL_BRANCH_URL) {
      baseUrl = `https://${process.env.VERCEL_BRANCH_URL}`;
      console.log('Using Vercel branch URL for webhook:', baseUrl);
    }
    
    // Add additional logging for debugging webhook URL construction
    console.log('Environment variables for webhook URL:');
    console.log('- NEXT_PUBLIC_VERCEL_URL:', process.env.NEXT_PUBLIC_VERCEL_URL || 'not set');
    console.log('- VERCEL_URL:', process.env.VERCEL_URL || 'not set');
    console.log('- VERCEL_BRANCH_URL:', process.env.VERCEL_BRANCH_URL || 'not set');
    console.log('- NEXT_PUBLIC_APP_URL:', process.env.NEXT_PUBLIC_APP_URL || 'not set');
    console.log('- VERCEL_ENV:', process.env.VERCEL_ENV || 'not set');
    
    // Force HTTPS for production environments
    if ((process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') && !baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    const webhookUrl = `${baseUrl}/api/rev-ai-webhook`;
    console.log('Final webhook URL:', webhookUrl);
    
    // Log the full request being sent to Rev.ai
    console.log('Sending request to Rev.ai with:');
    console.log('- API Key present:', REV_AI_API_KEY ? 'Yes' : 'No');
    console.log('- Media URL:', mediaUrl);
    console.log('- Webhook URL:', webhookUrl);
    
    const requestBody = {
      source_config: {
        url: mediaUrl
      },
      metadata: 'InsightAI Transcription',
      callback_url: webhookUrl
    };
    
    console.log('Request body:', JSON.stringify(requestBody));
    
    try {
      const response = await fetch(`${REV_AI_BASE_URL}/jobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REV_AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      // Log the raw response status and headers for debugging
      console.log('Rev.ai API response status:', response.status, response.statusText);
      console.log('Rev.ai API response headers:', JSON.stringify(Object.fromEntries([...response.headers.entries()])));
      
      // Try to get the response body as text first
      const responseText = await response.text();
      console.log('Rev.ai API response body:', responseText);
      
      if (!response.ok) {
        console.error('Rev.ai job submission failed:', responseText);
        console.error('Response status:', response.status, response.statusText);
        throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${responseText}`);
      }
      
      // Parse the response text as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse Rev.ai response as JSON:', parseError);
        throw new Error(`Invalid JSON response from Rev.ai: ${responseText}`);
      }
      
      console.log('Rev.ai job submitted successfully:', data.id);
      console.log('Full Rev.ai response:', JSON.stringify(data));
      return data;
    } catch (error) {
      console.error('Error submitting Rev.ai job:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error submitting Rev.ai job:', error);
    throw error;
  }
}

// Function to get the status of a Rev.ai job
async function getRevAiJobStatus(jobId: string) {
  try {
    const response = await fetch(`${REV_AI_BASE_URL}/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REV_AI_API_KEY}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Rev.ai job status check failed for job ${jobId}:`, errorText);
      throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`Rev.ai job ${jobId} status:`, data.status);
    return data;
  } catch (error) {
    console.error(`Error checking Rev.ai job status for job ${jobId}:`, error);
    throw error;
  }
}

// Function to get the transcript from a completed Rev.ai job
async function getRevAiTranscript(jobId: string) {
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
      console.error(`Rev.ai transcript retrieval failed for job ${jobId}:`, errorText);
      throw new Error(`Rev.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Extract the transcript text from the Rev.ai response
    let transcriptText = '';
    if (data.monologues && Array.isArray(data.monologues)) {
      for (const monologue of data.monologues) {
        if (monologue.elements && Array.isArray(monologue.elements)) {
          for (const element of monologue.elements) {
            if (element.value) {
              transcriptText += element.value + ' ';
            }
          }
        }
      }
    }
    
    console.log(`Rev.ai transcript retrieved for job ${jobId}, length: ${transcriptText.length} chars`);
    return transcriptText.trim();
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
        const transcript = await getRevAiTranscript(jobId);
        return transcript;
      } else if (jobStatus.status === 'failed') {
        throw new Error(`Rev.ai job failed: ${jobStatus.failure || 'Unknown error'}`);
      }
      
      console.log(`Rev.ai job still in progress (status: ${jobStatus.status}), attempt ${attempt}/${maxAttempts}`);
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Increase delay time with each attempt (exponential backoff)
      delayMs = Math.min(delayMs * 1.5, 60000); // Cap at 1 minute
    } catch (error) {
      console.error(`Error during polling attempt ${attempt}:`, error);
      
      // If this is the last attempt, throw the error
      if (attempt === maxAttempts) {
        throw error;
      }
      
      // Otherwise wait and try again
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error(`Rev.ai transcription timed out after ${maxAttempts} polling attempts`);
}

// Function to process audio files
async function processAudioFile(url: string, transcriptionId: string) {
  console.log(`Processing audio file with URL: ${url}`);
  
  try {
    // Check if this is a Supabase storage URL
    const isSupabaseUrl = url.includes('supabase.co/storage');
    
    // Fetch the file to check its size and type
    console.log('Fetching file to check size and type...');
    const response = await fetch(url, { method: 'HEAD' });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file metadata: ${response.status} ${response.statusText}`);
    }
    
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
    console.log(`File size: ${fileSize} bytes, type: ${contentType}`);
    
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`File size (${fileSize} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`);
    }
    
    // Generate a signed URL if this is a Supabase storage URL
    let accessibleUrl = url;
    if (isSupabaseUrl && supabaseAdmin) {
      console.log('Generating signed URL for Supabase storage file...');
      
      try {
        // Extract bucket and file path from the URL
        // URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
        const urlParts = url.split('/storage/v1/object/public/');
        if (urlParts.length === 2) {
          const [bucketAndPath] = urlParts[1].split('?');
          const [bucket, ...pathParts] = bucketAndPath.split('/');
          const filePath = pathParts.join('/');
          
          console.log(`Extracted bucket: ${bucket}, path: ${filePath}`);
          
          // Generate a signed URL that expires in 1 hour
          const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(filePath, 3600); // 1 hour expiry
          
          if (signedUrlError) {
            console.error('Error generating signed URL:', signedUrlError);
          } else if (signedUrlData?.signedUrl) {
            accessibleUrl = signedUrlData.signedUrl;
            console.log('Successfully generated signed URL for Rev.ai access');
          }
        }
      } catch (signedUrlError) {
        console.error('Error parsing URL or generating signed URL:', signedUrlError);
        console.log('Continuing with original URL as fallback');
      }
    } else {
      console.log(`URL appears to be a ${isSupabaseUrl ? 'Supabase storage URL without a token' : 'non-Supabase URL'}. This might not be accessible to Rev.ai`);
    }
    
    console.log(`Using URL for Rev.ai: ${accessibleUrl}`);
    
    // Verify if the URL is properly formatted and accessible
    if (!accessibleUrl.startsWith('http://') && !accessibleUrl.startsWith('https://')) {
      throw new Error(`Invalid URL format: ${accessibleUrl}. URL must start with http:// or https://`);
    }
    
    // Update the transcription record to indicate processing has started
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('transcriptions')
        .update({
          status: 'processing',
          transcription_text: 'Processing your audio file. Please wait...',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
    }
    
    // Check if Rev.ai API key is configured
    if (!REV_AI_API_KEY) {
      throw new Error('Rev.ai API key not configured. Please set the REV_AI_API_KEY environment variable.');
    }
    
    // Update status to indicate we're processing
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('transcriptions')
        .update({
          status: 'processing',
          transcription_text: 'Your audio is being processed. This may take several minutes.',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
    }
    
    // Ensure the URL is publicly accessible
    // If it's a Supabase storage URL, it might need to be a signed URL
    // Start a background process to handle the Rev.ai transcription
    // This won't block the API response
    (async () => {
      try {
        console.log('Starting background processing with Rev.ai');
        console.log(`Submitting job to Rev.ai with URL: ${accessibleUrl}`);
        
        // Submit the job to Rev.ai
        const revAiJob = await submitRevAiJob(accessibleUrl);
        
        // Update the transcription record with the Rev.ai job ID
        if (supabaseAdmin) {
          console.log(`Rev.ai job created with ID: ${revAiJob.id}, updating transcription record`);
          
          const { error: updateError } = await supabaseAdmin
            .from('transcriptions')
            .update({
              rev_ai_job_id: revAiJob.id,
              status: 'processing',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          if (updateError) {
            console.error('Error updating transcription record with Rev.ai job ID:', updateError);
          } else {
            console.log(`Successfully updated transcription record ${transcriptionId} with Rev.ai job ID ${revAiJob.id}`);
          }
        }
        
        // Poll for job completion
        const transcriptionText = await pollRevAiJobCompletion(revAiJob.id);
        
        // Update the database with the complete transcription
        if (supabaseAdmin) {
          await supabaseAdmin
            .from('transcriptions')
            .update({
              status: 'completed',
              transcription_text: transcriptionText,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        }
        
        console.log('Rev.ai transcription completed and saved to database');
      } catch (backgroundError: unknown) {
        console.error('Background Rev.ai transcription process failed:', backgroundError);
        
        // Update the database with the error
        if (supabaseAdmin) {
          await supabaseAdmin
            .from('transcriptions')
            .update({
              status: 'error',
              error: `Rev.ai processing failed: ${backgroundError instanceof Error ? backgroundError.message : String(backgroundError)}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        }
      }
    })().catch(error => {
      console.error('Unhandled error in Rev.ai background process:', error);
    });
    
    // Return a message indicating Rev.ai is being used
    return {
      message: "Audio file submitted to Rev.ai for transcription. This may take several minutes.",
      status: "processing"
    };
  } catch (error) {
    console.error('Error processing audio file:', error);
    
    // Update the status with the error
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('transcriptions')
        .update({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
    }
    
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
        success: false,
        error: 'Invalid JSON in request body',
        details: 'Please ensure the request body is valid JSON'
      }, { status: 400 });
    }
    
    const { transcriptionId, mediaUrl, accessToken, record } = body;
    
    // Basic validation with detailed error messages
    if (!transcriptionId) {
      console.error('Missing required field: transcriptionId');
      return NextResponse.json(
        { 
          success: false,
          error: 'Missing required field: transcriptionId'
        }, 
        { status: 400 }
      );
    }
    
    if (!mediaUrl) {
      console.error('Missing required field: mediaUrl');
      return NextResponse.json(
        { 
          success: false,
          error: 'Missing required field: mediaUrl'
        }, 
        { status: 400 }
      );
    }
    
    // Check for authentication token
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json(
        { 
          success: false,
          error: 'Authentication required. Please sign in and try again.'
        }, 
        { status: 401 }
      );
    }
    
    // Verify the token with Supabase
    const userResponse = supabaseAdmin?.auth.getUser(accessToken);
    if (!userResponse) {
      return NextResponse.json({
        success: false,
        error: 'Authentication failed: Supabase client not initialized'
      }, { status: 500 });
    }
    
    const { data: { user }, error: authError } = await userResponse;
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { 
          success: false,
          error: 'Authentication failed. Please sign in again or refresh the page to get a new session token.',
          details: authError?.message || 'Session token invalid or expired'
        }, 
        { status: 401 }
      );
    }
    
    // Get the transcription record from the database
    let transcriptionData;
    try {
      // Use retry operation to handle potential database timing issues
      transcriptionData = await retryOperation(async () => {
        if (!supabaseAdmin) {
          throw new Error('Supabase admin client not initialized');
        }
        
        const response = await supabaseAdmin
          .from('transcriptions')
          .select('*')
          .eq('id', transcriptionId)
          .single();
          
        if (response.error) {
          throw new Error(`Database error: ${response.error.message}`);
        }
        
        return response.data;
      }, 5, 500); // 5 retries with 500ms initial delay
      
      console.log('Successfully found transcription record:', transcriptionData.id);
    } catch (dbError) {
      console.error('Failed to retrieve transcription record after retries:', dbError);
      
      // Check if the record was provided by the client as a fallback
      if (record && record.id === transcriptionId) {
        console.log('Using record provided by client as fallback');
        transcriptionData = record;
      } else {
        return NextResponse.json(
          { 
            success: false,
            error: 'Transcription record not found', 
            details: dbError instanceof Error ? dbError.message : String(dbError)
          }, 
          { status: 404 }
        );
      }
    }
    
    // Check if the user has permission to access this transcription
    if (transcriptionData.user_id !== user.id) {
      console.error('Permission denied for user', user.id, 'to access transcription', transcriptionId);
      return NextResponse.json(
        { 
          success: false,
          error: 'You do not have permission to access this transcription'
        }, 
        { status: 403 }
      );
    }
    
    // Check if the transcription is already completed or in error state
    if (transcriptionData.status === 'completed') {
      console.log('Transcription already completed:', transcriptionId);
      return NextResponse.json({ 
        success: true,
        message: 'Transcription already completed',
        text: transcriptionData.transcription_text, 
        transcriptionText: transcriptionData.transcription_text, 
        isPartial: false
      });
    }
    
    if (transcriptionData.status === 'error') {
      console.log('Transcription previously failed:', transcriptionId, 'Error:', transcriptionData.error);
      // Allow retrying failed transcriptions
    }
    
    // Check if Rev.ai API key is configured
    const revAiApiKey = process.env.REV_AI_API_KEY;
    if (!revAiApiKey) {
      console.error('Rev.ai API key not configured');
      return NextResponse.json(
        { 
          success: false,
          error: 'Rev.ai API key not configured. Please set the REV_AI_API_KEY environment variable.',
          details: 'Missing API configuration'
        }, 
        { status: 500 }
      );
    }
    
    // Process the file using Rev.ai
    console.log('Starting Rev.ai transcription process for:', mediaUrl);
    const result = await processAudioFile(mediaUrl, transcriptionId);
    
    // Get the current transcription text from the database to include in the response
    let currentTranscription;
    try {
      if (!supabaseAdmin) {
        throw new Error('Supabase admin client not initialized');
      }
      
      const response = await supabaseAdmin
        .from('transcriptions')
        .select('transcription_text, status')
        .eq('id', transcriptionId)
        .single();
        
      if (response.error) {
        throw new Error(`Database error: ${response.error.message}`);
      }
      
      currentTranscription = response.data;
    } catch (fetchError) {
      console.error('Exception fetching current transcription:', fetchError);
    }
    
    // Use the most up-to-date information available
    const transcriptionText = currentTranscription?.transcription_text || 
                             transcriptionData.transcription_text || 
                             'Processing with Rev.ai...';
    
    const currentStatus = currentTranscription?.status || 
                         transcriptionData.status || 
                         'processing';
    
    // Map database fields to client interface fields
    return NextResponse.json({ 
      success: true,
      message: result.message,
      // Include both formats to ensure compatibility
      text: transcriptionText, // For backward compatibility
      transcriptionText: transcriptionText, // Matches client interface
      status: currentStatus,
      isPartial: true // Indicate that this is a partial response, client should poll for updates
    });
  } catch (error: any) {
    console.error('Transcription API error:', error);
    
    // Provide a detailed error response following the standardized format
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'An unexpected error occurred during transcription',
        details: error.stack ? error.stack.split('\n')[0] : 'No additional details'
      }, 
      { status: 500 }
    );
  }
}

// Add a global error handler to catch any unexpected errors and format them as JSON
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb' // Limit the size of the request body
    },
    externalResolver: true // This allows us to handle errors in the API route
  },
  fetchCache: 'force-no-store' // Prevent caching
};
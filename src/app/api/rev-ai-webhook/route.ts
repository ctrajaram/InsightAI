import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const REV_AI_API_KEY = typeof window === 'undefined' ? process.env.REV_AI_API_KEY || '' : '';
const REV_AI_BASE_URL = 'https://api.rev.ai/speechtotext/v1';

// Add debug logging for environment variables
console.log('Rev AI Webhook: Environment variables check:', {
  supabaseUrl: !!supabaseUrl ? 'Set' : 'Missing',
  serviceRoleKey: !!serviceRoleKey ? 'Set' : 'Missing',
  anonKey: !!anonKey ? 'Set' : 'Missing',
  revAiApiKey: !!REV_AI_API_KEY ? 'Set' : 'Missing',
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV
});

// Declare Supabase client variable but don't initialize it yet
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined') {
  try {
    // Create Supabase admin client with service role key for bypassing RLS
    // Fall back to anon key if service role key is not available
    if (supabaseUrl && (serviceRoleKey || anonKey)) {
      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || anonKey);
      console.log(`Rev AI Webhook: Supabase client initialized with ${serviceRoleKey ? 'service role' : 'anon'} key`);
    } else {
      console.error('Rev AI Webhook: Missing required Supabase environment variables');
    }
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabaseAdmin = null;
  }
}

// Helper function to retry a database operation with exponential backoff
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 500
): Promise<T> {
  let lastError: any;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 1.5; // Exponential backoff
    }
  }
  
  throw lastError;
}

// Function to get a transcript from Rev.ai
async function getRevAiTranscript(jobId: string): Promise<string> {
  console.log(`Getting transcript for Rev AI job ${jobId}`);
  
  const revAiApiKey = process.env.REV_AI_API_KEY;
  if (!revAiApiKey) {
    console.error('Rev AI API key not found');
    throw new Error('Rev AI API key not configured');
  }
  
  try {
    // Get the transcript from Rev.ai
    const response = await fetch(`https://api.rev.ai/speechtotext/v1/jobs/${jobId}/transcript`, {
      headers: {
        'Authorization': `Bearer ${revAiApiKey}`,
        'Accept': 'application/vnd.rev.transcript.v1.0+json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Rev AI API error (${response.status}): ${errorText}`);
      throw new Error(`Rev AI API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    
    // Extract the transcript text
    if (!data || !data.monologues) {
      console.error('Invalid transcript format from Rev.ai:', data);
      throw new Error('Invalid transcript format from Rev.ai');
    }
    
    // Combine all elements into a single transcript
    let transcript = '';
    for (const monologue of data.monologues) {
      if (monologue.elements) {
        for (const element of monologue.elements) {
          if (element.value) {
            transcript += element.value;
          }
        }
      }
    }
    
    return transcript;
  } catch (error: any) {
    console.error('Error getting transcript from Rev.ai:', error);
    throw error;
  }
}

// Prevent caching of this route
export const fetchCache = 'force-no-store';

// Configure route handler
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    externalResolver: true, // This tells Next.js this route is handled by an external resolver (Rev.ai webhook)
  },
};

// Define response types to fix TypeScript errors
type SuccessResponse = { success: true };
type ErrorResponse = { 
  success: false; 
  error: string;
  details?: string;
};

export async function POST(request: NextRequest) {
  console.log('Rev AI Webhook received');
  
  try {
    // Parse the webhook payload
    let payload: any; 
    try {
      payload = await request.json();
      console.log('Rev AI Webhook payload:', JSON.stringify(payload, null, 2));
    } catch (parseError: any) { 
      console.error('Failed to parse webhook payload:', parseError);
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid JSON payload' 
      } as ErrorResponse, { status: 400 });
    }
    
    // Extract the job ID and status
    const jobId = payload.job?.id;
    const status = payload.job?.status;
    
    if (!jobId) {
      console.error('No job ID in webhook payload');
      return NextResponse.json({ 
        success: false, 
        error: 'No job ID in webhook payload' 
      } as ErrorResponse, { status: 400 });
    }
    
    console.log(`Processing Rev AI webhook for job ${jobId} with status ${status}`);
    
    // Check if Supabase client is initialized
    if (!supabaseAdmin) {
      console.error('Supabase admin client not initialized');
      
      // Try to initialize it again as a last resort
      if (supabaseUrl && (serviceRoleKey || anonKey)) {
        try {
          supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || anonKey);
          console.log('Rev AI Webhook: Supabase client initialized on-demand');
        } catch (initError: any) { 
          console.error('Failed to initialize Supabase client on-demand:', initError);
        }
      }
      
      // If still not initialized, return error
      if (!supabaseAdmin) {
        return NextResponse.json({ 
          success: false, 
          error: 'Database client not initialized' 
        } as ErrorResponse, { status: 500 });
      }
    }
    
    // Find the transcription record with this Rev AI job ID using retry logic
    let transcriptions: { id: string; status: string }[] | null = null;
    let findError: any; // Type as 'any' to fix TypeScript errors
    
    try {
      console.log(`Looking for transcription with Rev AI job ID: "${jobId}"`);
      
      // First, check if the job ID exists in any records
      const { data: allTranscriptions, error: checkError } = await supabaseAdmin!
        .from('transcriptions')
        .select('id, rev_ai_job_id')
        .order('created_at', { ascending: false })
        .limit(10);
        
      if (checkError) {
        console.error('Error checking recent transcriptions:', checkError);
      } else if (allTranscriptions && allTranscriptions.length > 0) {
        console.log('Recent transcriptions:');
        allTranscriptions.forEach((t: any) => {
          console.log(`- ID: ${t.id}, Rev AI job ID: "${t.rev_ai_job_id}"`);
          
          // Check for case-insensitive match
          if (t.rev_ai_job_id && jobId && 
              t.rev_ai_job_id.toLowerCase() === jobId.toLowerCase()) {
            console.log(`Found case-insensitive match for job ID ${jobId} in transcription ${t.id}`);
            
            // Update with the exact job ID from the webhook to ensure future exact matches
            supabaseAdmin!
              .from('transcriptions')
              .update({ rev_ai_job_id: jobId })
              .eq('id', t.id)
              .then(({ error }) => {
                if (error) {
                  console.error('Error updating job ID case:', error);
                } else {
                  console.log(`Updated job ID case for transcription ${t.id}`);
                }
              });
          }
        });
      } else {
        console.log('No recent transcriptions found in database');
      }
      
      const result = await retryOperation(async () => {
        console.log(`Executing database query to find transcription with Rev AI job ID: "${jobId}"`);
        const { data, error } = await supabaseAdmin!
          .from('transcriptions')
          .select('id, status')
          .eq('rev_ai_job_id', jobId);
          
        if (error) {
          console.error(`Database error when finding transcription with Rev AI job ID "${jobId}":`, error);
          throw error;
        }
        
        console.log(`Query results for Rev AI job ID "${jobId}":`, data);
        return data;
      }, 3, 1000);
      
      transcriptions = result;
    } catch (error: any) { // Type the error as 'any'
      console.error('Database error when finding transcription after retries:', error);
      findError = error;
    }
    
    if (findError || !transcriptions || transcriptions.length === 0) {
      console.error('Could not find transcription with Rev AI job ID:', jobId);
      
      // Fallback: Try to find the transcription by filename if available
      if (payload.job?.name) {
        const filename = payload.job.name;
        console.log(`Attempting fallback lookup by filename: "${filename}"`);
        
        try {
          // Extract the base filename without timestamp prefix if it follows the pattern
          let searchPattern = filename;
          const timestampMatch = filename.match(/^\d+-(.+)$/);
          if (timestampMatch && timestampMatch[1]) {
            searchPattern = `%${timestampMatch[1]}`;
            console.log(`Extracted base filename for search: "${timestampMatch[1]}"`);
          }
          
          // Search for transcriptions with similar filenames
          type TranscriptionRecord = {
            id: string;
            status: string;
            file_name?: string;
            media_path?: string;
            created_at: string;
          };
          
          const { data: filenameMatches, error: filenameError } = await supabaseAdmin!
            .from('transcriptions')
            .select('id, status, file_name, media_path, created_at')
            .order('created_at', { ascending: false })
            .limit(5);
            
          if (filenameError) {
            console.error('Error in fallback filename lookup:', filenameError);
          } else if (filenameMatches && filenameMatches.length > 0) {
            console.log(`Found ${filenameMatches.length} recent transcriptions to check:`);
            
            // Log all potential matches
            (filenameMatches as TranscriptionRecord[]).forEach(match => {
              console.log(`- ID: ${match.id}, Filename: "${match.file_name}", Created: ${match.created_at}`);
            });
            
            // Use the most recent transcription as our best guess
            const mostRecent = filenameMatches[0] as TranscriptionRecord;
            console.log(`Using most recent transcription as fallback: ${mostRecent.id}`);
            
            // Update the transcription with the Rev AI job ID for future lookups
            const { error: updateError } = await supabaseAdmin!
              .from('transcriptions')
              .update({
                rev_ai_job_id: jobId,
                updated_at: new Date().toISOString()
              })
              .eq('id', mostRecent.id);
              
            if (updateError) {
              console.error('Error updating transcription with Rev AI job ID:', updateError);
            } else {
              console.log(`Successfully linked Rev AI job ID ${jobId} to transcription ${mostRecent.id}`);
              
              // Continue processing with this transcription
              transcriptions = [{ id: mostRecent.id, status: mostRecent.status }];
            }
          } else {
            console.log('No matching transcriptions found in fallback search');
          }
        } catch (fallbackError) {
          console.error('Error in fallback lookup:', fallbackError);
        }
      }
      
      // If we still don't have a transcription, return an error
      if (!transcriptions || transcriptions.length === 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'Transcription not found',
          details: findError ? String(findError) : 'No matching records'
        } as ErrorResponse, { status: 404 });
      }
    }
    
    const transcriptionId = transcriptions[0].id;
    const currentStatus = transcriptions[0].status;
    
    console.log(`Found transcription ${transcriptionId} for Rev AI job ${jobId}`);
    console.log(`Current transcription status in database: ${currentStatus}`);
    
    // Log the current status of the transcription in our database
    console.log(`Current transcription status in database: ${currentStatus}`);
    
    // If the job is complete, get the transcript and update the database
    if (status === 'transcribed') {
      console.log(`Rev AI job ${jobId} completed, getting transcript`);
      
      try {
        // Get the transcript
        const transcriptText = await getRevAiTranscript(jobId);
        
        if (!transcriptText || transcriptText.trim().length === 0) {
          console.error('Received empty transcript from Rev.ai');
          throw new Error('Empty transcript received from Rev.ai');
        }
        
        console.log(`Updating transcription ${transcriptionId} with transcript (${transcriptText.length} chars)`);
        
        // Update the transcription record with retry logic
        try {
          await retryOperation(async () => {
            const { error } = await supabaseAdmin!
              .from('transcriptions')
              .update({
                status: 'completed',
                transcription_text: transcriptText,
                updated_at: new Date().toISOString()
              })
              .eq('id', transcriptionId);
              
            if (error) throw error;
            return true;
          }, 3, 1000);
          
          console.log(`Successfully updated transcription ${transcriptionId} with transcript`);
          
          // Verify the update was successful
          const { data: verifyData, error: verifyError } = await supabaseAdmin!
            .from('transcriptions')
            .select('status, transcription_text')
            .eq('id', transcriptionId)
            .single();
            
          if (verifyError) {
            console.error('Error verifying transcription update:', verifyError);
          } else if (verifyData.status !== 'completed' || !verifyData.transcription_text) {
            console.error('Verification failed: Transcription not properly updated');
            console.log('Verification data:', verifyData);
          } else {
            console.log('Verification successful: Transcription properly updated');
          }
          
          return NextResponse.json({ success: true } as SuccessResponse);
        } catch (updateError: any) {
          console.error('Error updating transcription after retries:', updateError);
          throw updateError;
        }
      } catch (error: any) {
        console.error('Error processing completed transcription:', error);
        
        // Update the record with the error
        try {
          await supabaseAdmin!
            .from('transcriptions')
            .update({
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        } catch (errorUpdateError: any) {
          console.error('Failed to update transcription with error status:', errorUpdateError);
        }
          
        return NextResponse.json({ 
          success: false, 
          error: 'Error processing completed transcription',
          details: error instanceof Error ? error.message : String(error)
        } as ErrorResponse, { status: 500 });
      }
    } else if (status === 'failed') {
      // If the job failed, update the database with the error
      console.log(`Rev AI job ${jobId} failed`);
      
      try {
        await retryOperation(async () => {
          const { error } = await supabaseAdmin!
            .from('transcriptions')
            .update({
              status: 'error',
              error: payload.job?.failure || 'Rev AI job failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
            
          if (error) throw error;
          return true;
        }, 3, 1000);
        
        console.log(`Successfully updated transcription ${transcriptionId} with failure status`);
        return NextResponse.json({ success: true } as SuccessResponse);
      } catch (updateError: any) { 
        console.error('Error updating transcription with failure after retries:', updateError);
        return NextResponse.json({ 
          success: false, 
          error: 'Error updating transcription with failure',
          details: String(updateError)
        } as ErrorResponse, { status: 500 });
      }
    } else {
      // For other statuses, just log and acknowledge
      console.log(`Rev AI job ${jobId} status: ${status}`);
      return NextResponse.json({ success: true } as SuccessResponse);
    }
  } catch (error: any) { 
    console.error('Error processing Rev AI webhook:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Error processing webhook',
      details: error instanceof Error ? error.message : String(error)
    } as ErrorResponse, { status: 500 });
  }
}

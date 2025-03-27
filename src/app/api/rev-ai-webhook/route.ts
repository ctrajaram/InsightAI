import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REV_AI_API_KEY = typeof window === 'undefined' ? process.env.REV_AI_API_KEY || '' : '';
const REV_AI_BASE_URL = 'https://api.rev.ai/speechtotext/v1';

// Declare Supabase client variable but don't initialize it yet
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined' && supabaseUrl && serviceRoleKey) {
  try {
    // Create Supabase admin client with service role key for bypassing RLS
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    console.log('Rev AI Webhook: Supabase admin client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabaseAdmin = null;
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

export async function POST(request: NextRequest) {
  console.log('Rev AI Webhook received');
  
  try {
    // Parse the webhook payload
    const payload = await request.json();
    console.log('Rev AI Webhook payload:', JSON.stringify(payload, null, 2));
    
    // Extract the job ID and status
    const jobId = payload.job?.id;
    const status = payload.job?.status;
    
    if (!jobId) {
      console.error('No job ID in webhook payload');
      return NextResponse.json({ error: 'No job ID in webhook payload' }, { status: 400 });
    }
    
    console.log(`Processing Rev AI webhook for job ${jobId} with status ${status}`);
    
    // Check if Supabase client is initialized
    if (!supabaseAdmin) {
      console.error('Supabase admin client not initialized');
      return NextResponse.json({ error: 'Database client not initialized' }, { status: 500 });
    }
    
    // Find the transcription record with this Rev AI job ID
    const { data: transcriptions, error: findError } = await supabaseAdmin
      .from('transcriptions')
      .select('id, status')
      .eq('rev_ai_job_id', jobId);
      
    if (findError) {
      console.error('Database error when finding transcription:', findError);
      return NextResponse.json({ error: 'Database error when finding transcription' }, { status: 500 });
    }
    
    if (!transcriptions || transcriptions.length === 0) {
      console.error('Could not find transcription with Rev AI job ID:', jobId);
      return NextResponse.json({ error: 'Transcription not found' }, { status: 404 });
    }
    
    const transcriptionId = transcriptions[0].id;
    console.log(`Found transcription ${transcriptionId} for Rev AI job ${jobId}`);
    
    // Log the current status of the transcription in our database
    console.log(`Current transcription status in database: ${transcriptions[0].status}`);
    
    // If the job is complete, get the transcript and update the database
    if (status === 'transcribed') {
      console.log(`Rev AI job ${jobId} completed, getting transcript`);
      
      try {
        // Get the transcript
        const transcriptText = await getRevAiTranscript(jobId);
        
        // Update the transcription record
        const { error: updateError } = await supabaseAdmin
          .from('transcriptions')
          .update({
            status: 'completed',
            transcription_text: transcriptText,
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        if (updateError) {
          console.error('Error updating transcription:', updateError);
          return NextResponse.json({ error: 'Error updating transcription' }, { status: 500 });
        }
        
        console.log(`Successfully updated transcription ${transcriptionId} with transcript`);
        return NextResponse.json({ success: true });
      } catch (error) {
        console.error('Error processing completed transcription:', error);
        
        // Update the record with the error
        await supabaseAdmin
          .from('transcriptions')
          .update({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        return NextResponse.json({ error: 'Error processing completed transcription' }, { status: 500 });
      }
    } else if (status === 'failed') {
      // If the job failed, update the database with the error
      console.log(`Rev AI job ${jobId} failed`);
      
      const { error: updateError } = await supabaseAdmin
        .from('transcriptions')
        .update({
          status: 'error',
          error: payload.job?.failure || 'Rev AI job failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
        
      if (updateError) {
        console.error('Error updating transcription with failure:', updateError);
        return NextResponse.json({ error: 'Error updating transcription with failure' }, { status: 500 });
      }
      
      return NextResponse.json({ success: true });
    } else {
      // For other statuses, just log and acknowledge
      console.log(`Rev AI job ${jobId} status: ${status}`);
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error('Error processing Rev AI webhook:', error);
    return NextResponse.json({ error: 'Error processing webhook' }, { status: 500 });
  }
}

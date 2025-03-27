import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Force no caching to prevent stale responses
export const fetchCache = 'force-no-store';

export const config = {
  api: {
    bodyParser: false,
    // Enable external resolver for proper error handling
    externalResolver: true,
  },
};

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Add debug logging for environment variables
console.log('TRANSCRIBE API: Environment variables check:', {
  supabaseUrl: !!supabaseUrl ? 'Set' : 'Missing',
  supabaseKey: !!supabaseKey ? 'Set' : 'Missing',
  revAiApiKey: !!process.env.REV_AI_API_KEY ? 'Set' : 'Missing',
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV
});

// Declare Supabase client variable but don't initialize it yet
let supabase: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined' && supabaseUrl && supabaseKey) {
  try {
    // Create Supabase client without relying on cookies
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('AI Transcribe API: Supabase client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabase = null;
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log('TRANSCRIBE API: POST request received');
    // Get the access token from the Authorization header
    const authHeader = req.headers.get('authorization');
    const accessToken = authHeader ? authHeader.split(' ')[1] : null;
    
    console.log('TRANSCRIBE API: Access token check:', !!accessToken ? 'Present' : 'Missing');
    // Check for authentication token
    if (!accessToken) {
      console.error('No access token provided');
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Authentication required. Please sign in and try again.' 
        }), 
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Verify the token with Supabase
    if (!supabase) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Supabase client not initialized' 
        }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Authentication failed. Please sign in again or refresh the page to get a new session token.',
          details: authError?.message || 'Session token invalid or expired'
        }), 
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    console.log('User authenticated:', user.id);
    
    // Get the form data
    const formData = await req.formData();
    
    console.log('TRANSCRIBE API: Form data received');
    // Get the audio file from the form data
    const audioFile = formData.get('audio') as File;
    
    if (!audioFile) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Audio file is required'
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('TRANSCRIBE API: Audio file received');
    // Check if Rev.ai API key is configured
    const revAiApiKey = typeof window === 'undefined' ? process.env.REV_AI_API_KEY || '' : '';
    if (!revAiApiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Rev.ai API key not configured',
          details: 'Server configuration issue'
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('TRANSCRIBE API: Rev.ai API key check:', !!revAiApiKey ? 'Configured' : 'Missing');
    // We need to create a temporary URL for the audio file
    // For this demo route, we'll use a different approach:
    // 1. Upload the file to a temporary storage
    // 2. Get a URL for the file
    // 3. Submit the URL to Rev.ai

    // For simplicity in this demo, we'll use a data URL
    // Note: In production, you should upload to a proper storage service
    const audioBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const dataUrl = `data:${audioFile.type};base64,${base64Audio}`;
    
    console.log('TRANSCRIBE API: Audio file converted to data URL');
    // Submit the audio file to Rev.ai for transcription using the URL approach
    const response = await fetch('https://api.rev.ai/speechtotext/v1/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${revAiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_config: {
          url: dataUrl
        },
        metadata: 'InsightAI Transcription'
      })
    });

    console.log('TRANSCRIBE API: Rev.ai job submission attempt');
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Rev.ai job submission failed:', errorText);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Rev.ai API error',
          details: `${response.status} ${response.statusText} - ${errorText}`
        }),
        { 
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const job = await response.json();
    const jobId = job.id;

    console.log('TRANSCRIBE API: Rev.ai job submitted successfully:', jobId);
    // Poll for job completion
    let transcriptionText = '';
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    
    while (attempts < maxAttempts) {
      attempts++;
      
      console.log('TRANSCRIBE API: Checking Rev.ai job status:', jobId);
      // Check job status
      const statusResponse = await fetch(`https://api.rev.ai/speechtotext/v1/jobs/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${revAiApiKey}`,
        },
      });
      
      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error(`Rev.ai job status check failed for job ${jobId}:`, errorText);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Rev.ai API error',
            details: `${statusResponse.status} ${statusResponse.statusText} - ${errorText}`
          }),
          { 
            status: statusResponse.status,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      
      const jobStatus = await statusResponse.json();
      
      if (jobStatus.status === 'transcribed') {
        console.log('TRANSCRIBE API: Rev.ai job completed:', jobId);
        // Get the transcript
        const transcriptResponse = await fetch(`https://api.rev.ai/speechtotext/v1/jobs/${jobId}/transcript`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${revAiApiKey}`,
            'Accept': 'application/vnd.rev.transcript.v1.0+json',
          },
        });
        
        if (!transcriptResponse.ok) {
          const errorText = await transcriptResponse.text();
          console.error(`Rev.ai transcript retrieval failed for job ${jobId}:`, errorText);
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Rev.ai API error',
              details: `${transcriptResponse.status} ${transcriptResponse.statusText} - ${errorText}`
            }),
            { 
              status: transcriptResponse.status,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        
        const transcript = await transcriptResponse.json();
        
        // Extract the transcript text
        if (transcript.monologues && Array.isArray(transcript.monologues)) {
          for (const monologue of transcript.monologues) {
            if (monologue.elements && Array.isArray(monologue.elements)) {
              for (const element of monologue.elements) {
                if (element.value) {
                  transcriptionText += element.value + ' ';
                }
              }
            }
          }
        }
        
        break;
      } else if (jobStatus.status === 'failed') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Rev.ai job failed',
            details: jobStatus.failure || 'Unknown error'
          }),
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      
      // Wait before checking again
      console.log('TRANSCRIBE API: Waiting for Rev.ai job to complete...');
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
    }
    
    if (!transcriptionText) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Transcription timed out or failed'
        }),
        { 
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('TRANSCRIBE API: Transcription completed successfully');
    return new Response(
      JSON.stringify({ 
        transcript: transcriptionText.trim() 
      }),
      { 
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error processing your request',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
}
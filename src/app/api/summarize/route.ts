export const fetchCache = "force-no-store";

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

// Add debug logging for environment variables
console.log('SUMMARIZE API: Environment variables check:', {
  supabaseUrl: !!supabaseUrl ? 'Set' : 'Missing',
  supabaseServiceRoleKey: !!supabaseServiceRoleKey ? 'Set' : 'Missing',
  supabaseAnonKey: !!supabaseAnonKey ? 'Set' : 'Missing',
  openaiApiKey: !!openaiApiKey ? 'Set' : 'Missing',
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV
});

// Declare client variables but don't initialize them yet
let openai: OpenAI | null = null;
let supabase: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined') {
  // Initialize OpenAI client
  if (openaiApiKey) {
    try {
      openai = new OpenAI({
        apiKey: openaiApiKey,
      });
      console.log('Summarize API: OpenAI client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OpenAI client:', error);
      openai = null;
    }
  }
  
  // Initialize Supabase client
  if (supabaseUrl && (supabaseServiceRoleKey || supabaseAnonKey)) {
    try {
      supabase = createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey);
      console.log(`Summarize API: Supabase client initialized with ${supabaseServiceRoleKey ? 'service role' : 'anon'} key`);
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error);
      supabase = null;
    }
  }
}

// Set a longer timeout for this route (5 minutes)
export const maxDuration = 300; // 5 minutes in seconds (maximum allowed on Vercel Pro plan)

// Set a larger body size limit and configure error handling
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
    externalResolver: true, // This tells Next.js this route is handled by an external resolver
  },
};

// Define response types to fix TypeScript errors
type SuccessResponse = { 
  success: true;
  summary?: string;
  summaryStatus?: string;
};

type ErrorResponse = { 
  success: false; 
  error: string;
  details?: string;
};

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

export async function POST(request: NextRequest) {
  console.log('Summarize API: Starting POST handler');
  
  try {
    // Log request headers to help debug
    const headers = Object.fromEntries(request.headers.entries());
    console.log('Summarize API: Request headers:', JSON.stringify(headers, null, 2));
    
    // Check if the request body is empty
    const contentLength = request.headers.get('content-length');
    console.log('Content-Length header:', contentLength);
    
    if (!contentLength || parseInt(contentLength) === 0) {
      console.error('Empty request body received (content-length is 0 or missing)');
      return NextResponse.json({
        success: false,
        error: 'Empty request body',
      } as ErrorResponse, { status: 400 });
    }
    
    // Parse the request body
    let body: any;
    let bodyText = '';
    
    try {
      // Clone the request before reading it as text
      const clonedReq = request.clone();
      
      try {
        // First try to read as text to log the content
        bodyText = await clonedReq.text();
        console.log('Request body as text (first 100 chars):', bodyText.substring(0, 100) + (bodyText.length > 100 ? '...' : ''));
        
        // If the body is empty, return an error
        if (!bodyText || !bodyText.trim()) {
          console.error('Empty request body text despite non-zero content-length');
          return NextResponse.json({
            success: false,
            error: 'Empty request body',
            details: 'Request body was empty despite content-length header indicating content'
          } as ErrorResponse, { status: 400 });
        }
        
        // Parse the text as JSON
        try {
          body = JSON.parse(bodyText);
          console.log('Successfully parsed request body:', JSON.stringify(body, null, 2));
        } catch (jsonError: any) {
          console.error('Failed to parse request body as JSON:', jsonError, 'Raw body:', bodyText);
          return NextResponse.json({
            success: false,
            error: 'Invalid JSON in request body',
            details: jsonError instanceof Error ? jsonError.message : 'Unknown parsing error'
          } as ErrorResponse, { status: 400 });
        }
      } catch (textError: any) {
        console.error('Failed to read request as text:', textError);
        
        try {
          // If text reading fails, try with json() directly on the original request
          const fallbackReq = request.clone();
          body = await fallbackReq.json();
          console.log('Successfully parsed request body using json() method:', JSON.stringify(body, null, 2));
        } catch (jsonError: any) {
          console.error('Failed to parse request body as JSON after text failure:', jsonError);
          return NextResponse.json({
            success: false,
            error: 'Invalid or empty request body',
            details: jsonError instanceof Error ? jsonError.message : 'Unknown parsing error'
          } as ErrorResponse, { status: 400 });
        }
      }
    } catch (error: any) {
      console.error('Unexpected error processing request body:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to process request body',
        details: error instanceof Error ? error.message : 'Unknown error'
      } as ErrorResponse, { status: 400 });
    }
    
    const { transcriptionId, accessToken } = body || {};
    
    // Validate required parameters
    if (!transcriptionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required parameter: transcriptionId' 
      } as ErrorResponse, { status: 400 });
    }
    
    // Initialize Supabase clients
    let supabaseAdmin: ReturnType<typeof createClient> | null = null;
    
    try {
      // Initialize Supabase admin client
      if (supabaseUrl && (supabaseServiceRoleKey || supabaseAnonKey)) {
        console.log(`Summarize API: Using ${supabaseServiceRoleKey ? 'service role' : 'anon'} key for admin client`);
        supabaseAdmin = createClient(
          supabaseUrl,
          supabaseServiceRoleKey || supabaseAnonKey
        );
      }
    } catch (error: any) {
      console.error('Error initializing Supabase admin client:', error);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to initialize database connection' 
      } as ErrorResponse, { status: 500 });
    }
    
    // Check if Supabase admin client was initialized
    if (!supabaseAdmin) {
      console.error('Supabase admin client not initialized due to missing environment variables');
      return NextResponse.json({ 
        success: false, 
        error: 'Server configuration error: Database client not initialized' 
      } as ErrorResponse, { status: 500 });
    }
    
    // Check if the transcription exists and get the current status
    let transcription;
    try {
      const { data, error } = await retryOperation(async () => {
        const result = await supabaseAdmin
          .from('transcriptions')
          .select('id, user_id, transcription_text, status, summary_status, summary_text')
          .eq('id', transcriptionId)
          .single();
          
        if (result.error) throw result.error;
        return result;
      }, 3, 1000);
      
      if (error) throw error;
      transcription = data;
    } catch (fetchError: any) {
      console.error('Error fetching transcription:', fetchError);
      return NextResponse.json({ 
        success: false, 
        error: 'Transcription not found',
        details: fetchError.message 
      } as ErrorResponse, { status: 404 });
    }
    
    // Ensure we have a valid transcription object
    if (!transcription || typeof transcription !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'Invalid transcription data format'
      } as ErrorResponse, { status: 400 });
    }
    
    // If the transcription is already summarized, return the summary
    if (transcription.summary_status === 'completed' && transcription.summary_text) {
      console.log(`Transcription ${transcriptionId} already has a summary`);
      return NextResponse.json({ 
        success: true,
        summary: transcription.summary_text,
        summaryStatus: 'completed'
      } as SuccessResponse);
    }
    
    // If the transcription is in progress, return the current status
    if (transcription.summary_status === 'in_progress') {
      console.log(`Transcription ${transcriptionId} summary is in progress`);
      return NextResponse.json({ 
        success: true,
        summaryStatus: 'in_progress'
      } as SuccessResponse, { status: 202 });
    }
    
    // If the transcription is not completed, return an error
    if (transcription.status !== 'completed' || !transcription.transcription_text) {
      console.log(`Transcription ${transcriptionId} is not completed (status: ${transcription.status})`);
      return NextResponse.json({ 
        success: false, 
        error: 'Transcription is not completed',
        details: `Current status: ${transcription.status}`
      } as ErrorResponse, { status: 400 });
    }
    
    // Extract the text to summarize
    const textToSummarize = transcription.transcription_text;
    
    // Validate the text
    if (typeof textToSummarize !== 'string') {
      console.error('Invalid transcription text format:', typeof textToSummarize);
      return NextResponse.json({
        success: false,
        error: 'Invalid transcription text format'
      } as ErrorResponse, { status: 400 });
    }
    
    // Check if the text is empty
    if (!textToSummarize.trim()) {
      console.error('Transcription text is empty');
      return NextResponse.json({
        success: false,
        error: 'Transcription text is empty'
      } as ErrorResponse, { status: 400 });
    }
    
    // Update the summary status to in_progress
    try {
      const { error: updateError } = await supabaseAdmin
        .from('transcriptions')
        .update({
          summary_status: 'in_progress',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);
        
      if (updateError) {
        console.error('Error updating summary status to in_progress:', updateError);
        throw updateError;
      }
    } catch (error: any) {
      console.error('Error updating summary status:', error);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update summary status',
        details: error.message 
      } as ErrorResponse, { status: 500 });
    }
    
    // Perform summarization with OpenAI
    try {
      // Check if OpenAI client is initialized
      if (!openai) {
        console.error('OpenAI client not initialized');
        return NextResponse.json({ 
          success: false, 
          error: 'Server configuration error: AI client not initialized' 
        } as ErrorResponse, { status: 500 });
      }
      
      // Prepare the prompt for OpenAI
      const prompt = `
        Please provide a concise summary of the following transcription. 
        Focus on the main topics discussed, key points, and any important conclusions.
        
        Transcription:
        ${textToSummarize}
      `;
      
      console.log(`Generating summary for transcription ${transcriptionId}`);
      
      // Call OpenAI API
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes transcriptions accurately and concisely.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });
      
      // Extract the summary from the response
      const summary = response.choices[0]?.message?.content?.trim();
      
      if (!summary) {
        throw new Error('Failed to generate summary: Empty response from OpenAI');
      }
      
      console.log(`Summary generated for transcription ${transcriptionId} (${summary.length} chars)`);
      
      // Update the transcription with the summary
      try {
        const { error: updateError } = await supabaseAdmin
          .from('transcriptions')
          .update({
            summary_text: summary,
            summary_status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        if (updateError) {
          console.error('Error updating transcription with summary:', updateError);
          throw updateError;
        }
        
        console.log(`Successfully updated transcription ${transcriptionId} with summary`);
        
        // Return the summary
        return NextResponse.json({ 
          success: true,
          summary: summary,
          summaryStatus: 'completed'
        } as SuccessResponse);
      } catch (updateError: any) {
        console.error('Error updating transcription with summary:', updateError);
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to save summary',
          details: updateError.message 
        } as ErrorResponse, { status: 500 });
      }
    } catch (error: any) {
      console.error('Error generating summary:', error);
      
      // Update the transcription with the error
      try {
        await supabaseAdmin
          .from('transcriptions')
          .update({
            summary_status: 'error',
            error: error.message || 'Unknown error during summarization',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
      } catch (updateError: any) {
        console.error('Error updating transcription with error status:', updateError);
      }
      
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to generate summary',
        details: error.message 
      } as ErrorResponse, { status: 500 });
    }
  } catch (error: any) {
    console.error('Unexpected error in summarize API:', error);
    return NextResponse.json({
      success: false,
      error: 'Summarization failed',
      message: error.message || 'An unexpected error occurred',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    } as ErrorResponse, { status: 500 });
  }
}
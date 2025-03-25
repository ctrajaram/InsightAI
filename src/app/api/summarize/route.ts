import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Create a standard Supabase client
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
    
    const { transcriptionId, transcriptionText, accessToken } = body;
    
    // Basic validation with detailed error messages
    if (!transcriptionId) {
      console.error('Missing required field: transcriptionId');
      return NextResponse.json(
        { error: 'Missing required field: transcriptionId' }, 
        { status: 400 }
      );
    }
    
    if (!transcriptionText) {
      console.error('Missing required field: transcriptionText');
      return NextResponse.json(
        { error: 'Missing required field: transcriptionText' }, 
        { status: 400 }
      );
    }
    
    if (typeof transcriptionText !== 'string') {
      console.error('Invalid transcription text type:', typeof transcriptionText);
      return NextResponse.json(
        { error: 'Transcription text must be a string' }, 
        { status: 400 }
      );
    }
    
    if (transcriptionText.trim().length < 10) {
      console.error('Transcription text too short for summarization');
      return NextResponse.json(
        { error: 'Transcription text too short for summarization' }, 
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
    
    console.log(`Processing summary for user: ${user.email} (ID: ${user.id}), transcription: ${transcriptionId}`);
    
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
    
    // Update transcription record to show summarizing status with retry mechanism
    try {
      await retryOperation(async () => {
        const { error: updateError } = await supabase
          .from('transcriptions')
          .update({ summary_status: 'processing' })
          .eq('id', transcriptionId);
        
        if (updateError) {
          console.error('Error updating summary status:', updateError);
          throw updateError;
        }
      });
    } catch (updateError) {
      console.error('All attempts to update summary status failed:', updateError);
      return NextResponse.json(
        { error: 'Failed to update summary status after multiple attempts' }, 
        { status: 500 }
      );
    }
    
    // Craft the prompt for GPT-4
    const prompt = `
    Create a concise summary of the following transcript. 
    Highlight key points, main topics discussed, and any actionable items or conclusions.
    Focus on delivering the most important information in a clear, organized manner.
    
    TRANSCRIPT:
    ${transcriptionText}
    
    SUMMARY:
    `;
    
    // Generate summary with GPT-4 with timeout handling
    console.log('Sending to GPT-4 for summarization...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are a skilled assistant that creates concise, accurate summaries of transcribed content." },
          { role: "user", content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 500,
      }, { signal: controller.signal });
      
      clearTimeout(timeoutId); // Clear the timeout if the request completes successfully
      
      // Extract the generated summary
      const summaryText = completion.choices[0].message.content?.trim();
      console.log('Summary generated, length:', summaryText?.length);
      
      if (!summaryText) {
        throw new Error('Failed to generate summary: Empty response from OpenAI');
      }
      
      // Update the database with the summary using retry mechanism
      try {
        await retryOperation(async () => {
          const { error: saveError } = await supabase
            .from('transcriptions')
            .update({
              summary_text: summaryText,
              summary_status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          if (saveError) {
            console.error('Error saving summary to database:', saveError);
            throw saveError;
          }
        });
        
        console.log('Summary saved to database successfully');
      } catch (saveError) {
        console.error('All attempts to save summary failed:', saveError);
        return NextResponse.json(
          { error: 'Failed to save summary to database after multiple attempts' }, 
          { status: 500 }
        );
      }
      
      // Return the summary
      return NextResponse.json({
        success: true,
        transcriptionId,
        summary: {
          text: summaryText,
          status: 'completed'
        }
      });
    } catch (error: any) {
      clearTimeout(timeoutId); // Make sure to clear the timeout
      
      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        console.error('OpenAI API request timed out after 2 minutes');
        
        // Update the record with error status
        try {
          await supabase
            .from('transcriptions')
            .update({
              summary_status: 'error',
              error: 'The summarization process timed out',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        } catch (updateError) {
          console.error('Error updating summary error status:', updateError);
        }
        
        return NextResponse.json({ 
          error: 'The summarization process timed out',
          details: 'The request to the AI service took too long to complete. Please try again with a shorter transcript.'
        }, { status: 504 }); // Gateway Timeout
      }
      
      throw error; // Re-throw for the outer catch block
    }
  } catch (error: any) {
    console.error('Summarization API error:', error);
    
    // Try to update the transcription record with error status
    try {
      const body = await request.json().catch(_ => null);
      const transcriptionId = body?.transcriptionId;
      
      if (transcriptionId) {
        await supabase
          .from('transcriptions')
          .update({
            summary_status: 'error',
            error: error.message || 'Error generating summary',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
      }
    } catch (updateError) {
      console.error('Error updating summary error status:', updateError);
    }
    
    return NextResponse.json(
      { error: error.message || 'An error occurred during summarization' },
      { status: 500 }
    );
  }
}

// Configure response options
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
};
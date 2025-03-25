import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Create Supabase client without relying on cookies
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Interface for structured summary data
interface SummaryData {
  text: string;
  keyPoints?: string[];
  topics?: string[];
}

// Function to safely handle JSON parsing with fallbacks
function safelyParseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('JSON parse error:', error);
    // Try to extract JSON-like structure from the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (nestedError) {
        console.error('Nested JSON parse error:', nestedError);
      }
    }
    
    // If all parsing fails, return a basic structure with the text
    return { text: text };
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body with proper error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body as JSON:', parseError);
      return NextResponse.json({
        success: false,
        error: 'Invalid JSON in request body'
      }, { status: 400 });
    }
    
    // Extract and validate the required fields
    const { transcriptionId, transcriptionText, accessToken } = body;
    
    if (!transcriptionId) {
      console.error('Missing required field: transcriptionId');
      return NextResponse.json({
        success: false,
        error: 'Missing required field: transcriptionId'
      }, { status: 400 });
    }
    
    if (!transcriptionText) {
      console.error('Missing required field: transcriptionText');
      return NextResponse.json({
        success: false,
        error: 'Missing required field: transcriptionText'
      }, { status: 400 });
    }
    
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }
    
    // Verify the token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return NextResponse.json({
        success: false,
        error: 'Authentication failed. Please sign in again.'
      }, { status: 401 });
    }
    
    // Check if this transcription belongs to the authenticated user
    const { data: transcription, error: transcriptionError } = await supabase
      .from('transcriptions')
      .select('id, user_id, status, summary_status')
      .eq('id', transcriptionId)
      .single();
    
    if (transcriptionError) {
      console.error('Error fetching transcription:', transcriptionError);
      return NextResponse.json({
        success: false,
        error: 'Transcription not found'
      }, { status: 404 });
    }
    
    if (transcription.user_id !== user.id) {
      console.error(`Unauthorized: User ${user.id} attempted to access transcription owned by ${transcription.user_id}`);
      return NextResponse.json({
        success: false,
        error: 'You do not have permission to access this transcription'
      }, { status: 403 });
    }
    
    // Mark the transcription as being summarized
    console.log('Setting summary_status to processing');
    
    try {
      await retryOperation(async () => {
        const { error } = await supabase
          .from('transcriptions')
          .update({ summary_status: 'processing' })
          .eq('id', transcriptionId);
        
        if (error) {
          console.error('Error updating summary status:', error);
          throw error;
        }
      });
    } catch (updateError) {
      console.error('Failed to update summary status after retries:', updateError);
      // Continue anyway, but log the issue
    }
    
    // Prepare the prompt for OpenAI
    const systemPrompt = `
      You are an AI assistant specializing in summarizing transcripts. The user will provide a transcript.
      
      Please provide a summary in JSON format with the following structure:
      {
        "text": "A concise 2-3 paragraph summary of the main points discussed",
        "keyPoints": ["A list of 3-5 bullet points highlighting the key takeaways"],
        "topics": ["A list of main topics covered in the discussion"]
      }
      
      Keep your summary clear, accurate, and focused on the most important information.
    `;
    
    // Set a timeout for the OpenAI request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      // Call OpenAI for summarization
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Please summarize the following transcript:\n\n${transcriptionText}` }
        ],
        temperature: 0.3,
        max_tokens: 800
      }, { signal: controller.signal });
      
      // Clear the timeout if we get a response
      clearTimeout(timeoutId);
      
      // Process the response
      const responseContent = completion.choices[0]?.message?.content || '';
      console.log('Raw response from OpenAI:', responseContent.substring(0, 200) + '...');
      
      // Parse the response safely
      let summaryData: SummaryData;
      try {
        summaryData = safelyParseJSON(responseContent);
        
        // If we get an object without a text field, ensure there's something in the text field
        if (!summaryData.text && typeof responseContent === 'string') {
          summaryData.text = responseContent;
        }
      } catch (parseError) {
        console.error('Error parsing summary data:', parseError);
        
        // If parsing fails, use the raw text
        summaryData = {
          text: responseContent
        };
      }
      
      console.log('Processed summary data:', JSON.stringify(summaryData).substring(0, 200) + '...');
      
      if (!summaryData.text || summaryData.text.trim().length === 0) {
        throw new Error('Generated summary is empty');
      }
      
      // Update the database with the summary
      try {
        await retryOperation(async () => {
          const { error } = await supabase
            .from('transcriptions')
            .update({
              summary_status: 'completed',
              summary_text: summaryData.text,
              summary_data: summaryData,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          if (error) {
            console.error('Error updating summary:', error);
            throw error;
          }
        });
        
        console.log('Successfully updated transcription with summary');
      } catch (updateError) {
        console.error('Failed to update transcription with summary after multiple retries:', updateError);
        
        // Even though the database update failed, we can still return the summary to the client
        console.log('Returning summary to client despite database update failure');
      }
      
      // Return the success response with summary
      return NextResponse.json({
        success: true,
        summary: summaryData
      });
      
    } catch (openaiError: any) {
      // Clear the timeout if there was an error
      clearTimeout(timeoutId);
      
      console.error('OpenAI summarization error:', openaiError);
      
      // Check if this was an abort error (timeout)
      if (openaiError.name === 'AbortError' || openaiError.code === 'ETIMEDOUT') {
        console.error('Summary generation timed out after 2 minutes');
        
        await supabase
          .from('transcriptions')
          .update({
            summary_status: 'error',
            error: 'Summary generation timed out',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        return NextResponse.json({
          success: false,
          error: 'The summary generation process timed out'
        }, { status: 504 });
      }
      
      // If something else went wrong with OpenAI
      let errorMessage = openaiError.message || 'Error generating summary';
      
      try {
        await supabase
          .from('transcriptions')
          .update({
            summary_status: 'error',
            error: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
      } catch (updateError) {
        console.error('Failed to update error status in database:', updateError);
      }
      
      return NextResponse.json({
        success: false,
        error: 'Failed to generate summary',
        details: errorMessage
      }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('Unexpected error in summarize API:', error);
    
    return NextResponse.json({
      success: false,
      error: 'An unexpected error occurred',
      details: error.message
    }, { status: 500 });
  }
}

// Configure response options
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
};
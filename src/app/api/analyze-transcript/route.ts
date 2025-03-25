export const fetchCache = "force-no-store";

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

// Define interfaces for better type safety
interface TranscriptionRecord {
  id: string;
  user_id: string;
  transcription_text: string;
  status: string;
  summary_status?: string;
  analysis_status?: string;
  analysis_data?: any;
  error?: string;
}

interface AnalysisData {
  topics?: string[];
  keyInsights?: string[];
  actionItems?: string[];
  sentiment?: string;
  toneAnalysis?: string;
  summary?: string;
  questions?: string[];
}

// Safe JSON parsing function
function safelyParseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('JSON parse error:', error);
    // Try to extract JSON-like structure from text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (nestedError) {
        console.error('Nested JSON parse error:', nestedError);
      }
    }
    
    // If all parsing fails, return an object with just the text
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
    
    console.log(`Processing analysis for user: ${user.email} (ID: ${user.id})`);
    
    // Check if this transcription belongs to the authenticated user
    let { data: transcription, error: transcriptionError } = await supabase
      .from('transcriptions')
      .select('id, user_id, transcription_text, status, analysis_status, summary_status')
      .eq('id', transcriptionId)
      .single();
    
    if (transcriptionError) {
      console.error('Error fetching transcription:', transcriptionError);
      
      // Try to find the transcription with a retry mechanism
      try {
        const foundTranscription = await retryOperation(async () => {
          const { data, error } = await supabase
            .from('transcriptions')
            .select('id, user_id, transcription_text, status, analysis_status, summary_status')
            .eq('id', transcriptionId)
            .single();
            
          if (error) throw error;
          if (!data) throw new Error('Transcription not found after retry');
          return data;
        }, 3, 1000);
        
        console.log('Found transcription after recovery attempts:', foundTranscription.id);
        transcription = foundTranscription;
      } catch (retryError) {
        console.error('Failed to find transcription after retries:', retryError);
        
        // Last attempt: try to find any recent transcriptions for this user
        const { data: recentTranscriptions } = await supabase
          .from('transcriptions')
          .select('id, user_id, transcription_text, status, analysis_status, summary_status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);
          
        console.log('Recent transcriptions for user:', recentTranscriptions || []);
        
        if (!recentTranscriptions || recentTranscriptions.length === 0) {
          return NextResponse.json({
            success: false,
            error: 'Transcription not found',
            details: transcriptionError.message
          }, { status: 404 });
        }
        
        // Use the most recent transcription as a fallback
        transcription = {
          id: recentTranscriptions[0].id,
          user_id: recentTranscriptions[0].user_id,
          transcription_text: recentTranscriptions[0].transcription_text,
          status: recentTranscriptions[0].status,
          analysis_status: recentTranscriptions[0].analysis_status,
          summary_status: recentTranscriptions[0].summary_status
        };
        console.log('Using most recent transcription as fallback:', transcription.id);
      }
    }
    
    if (transcription === null || transcription === undefined) {
      console.error(`Transcription with ID ${transcriptionId} not found`);
      return NextResponse.json({
        success: false,
        error: 'Transcription not found',
        details: `No transcription found with ID: ${transcriptionId}`
      }, { status: 404 });
    }
    
    if (transcription.user_id !== user.id) {
      console.error(`Unauthorized: User ${user.id} attempted to access transcription owned by ${transcription.user_id}`);
      return NextResponse.json({
        success: false,
        error: 'You do not have permission to access this transcription'
      }, { status: 403 });
    }
    
    // Mark the transcription as being analyzed
    try {
      await retryOperation(async () => {
        const { error } = await supabase
          .from('transcriptions')
          .update({ analysis_status: 'processing' })
          .eq('id', transcriptionId);
        
        if (error) {
          console.error('Error updating analysis status:', error);
          throw error;
        }
      });
    } catch (updateError) {
      console.error('Failed to update analysis status after retries:', updateError);
      // Continue anyway, but log the issue
    }
    
    // Prepare a structured prompt for OpenAI
    const systemPrompt = `
      You are an AI assistant specializing in transcript analysis. The user will provide a transcript.
      
      Please analyze the transcript and provide a response in JSON format with the following structure:
      {
        "topics": ["List of main topics discussed"],
        "keyInsights": ["List of key insights from the conversation"],
        "actionItems": ["List of action items or next steps mentioned"],
        "sentiment": "Overall sentiment of the conversation (positive, negative, neutral, or mixed)",
        "toneAnalysis": "Brief analysis of the tone and style of communication",
        "questions": ["Important questions raised during the conversation"]
      }
      
      Keep your analysis factual, concise, and directly based on content from the transcript.
    `;
    
    // Set a timeout for the OpenAI request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      // Call OpenAI for analysis
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Please analyze the following transcript:\n\n${transcriptionText}` }
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
      let analysisData: AnalysisData;
      try {
        analysisData = safelyParseJSON(responseContent);
      } catch (parseError) {
        console.error('Error parsing analysis data:', parseError);
        
        // If parsing fails, use the raw text
        analysisData = {
          summary: responseContent
        };
      }
      
      console.log('Processed analysis data:', JSON.stringify(analysisData).substring(0, 200) + '...');
      
      if (!analysisData || Object.keys(analysisData).length === 0) {
        throw new Error('Generated analysis is empty or invalid');
      }
      
      // Update the database with the analysis
      try {
        await retryOperation(async () => {
          const { error } = await supabase
            .from('transcriptions')
            .update({
              analysis_status: 'completed',
              analysis_data: analysisData,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          if (error) {
            console.error('Error updating analysis:', error);
            throw error;
          }
        });
        
        console.log('Successfully updated transcription with analysis');
      } catch (updateError) {
        console.error('Failed to update transcription with analysis after multiple retries:', updateError);
        
        // Even though the database update failed, we can still return the analysis to the client
        console.log('Returning analysis to client despite database update failure');
      }
      
      // Return the success response with analysis
      return NextResponse.json({
        success: true,
        analysis: analysisData
      });
      
    } catch (openaiError: any) {
      // Clear the timeout if there was an error
      clearTimeout(timeoutId);
      
      console.error('OpenAI analysis error:', openaiError);
      
      // Check if this was an abort error (timeout)
      if (openaiError.name === 'AbortError' || openaiError.code === 'ETIMEDOUT') {
        console.error('Analysis generation timed out after 2 minutes');
        
        await supabase
          .from('transcriptions')
          .update({
            analysis_status: 'error',
            error: 'Analysis generation timed out',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        return NextResponse.json({
          success: false,
          error: 'The analysis generation process timed out'
        }, { status: 504 });
      }
      
      // If something else went wrong with OpenAI
      let errorMessage = openaiError.message || 'Error generating analysis';
      
      try {
        await supabase
          .from('transcriptions')
          .update({
            analysis_status: 'error',
            error: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
      } catch (updateError) {
        console.error('Failed to update error status in database:', updateError);
      }
      
      return NextResponse.json({
        success: false,
        error: 'Failed to generate analysis',
        details: errorMessage
      }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('Unexpected error in analyze-transcript API:', error);
    
    // Ensure the error response is valid JSON
    return NextResponse.json({ 
      success: false,
      error: 'An unexpected error occurred',
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}

// Add a global error handler to catch any unexpected errors and format them as JSON
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    externalResolver: true, // This tells Next.js that this route will handle its own errors
  },
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
};

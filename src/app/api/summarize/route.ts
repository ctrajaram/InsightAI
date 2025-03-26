export const fetchCache = "force-no-store";

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing required environment variables for Supabase:');
  console.error(`NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl ? 'Set' : 'Missing'}`);
  console.error(`SUPABASE_SERVICE_ROLE_KEY: ${serviceRoleKey ? 'Set' : 'Missing'}`);
  console.error(`NEXT_PUBLIC_SUPABASE_ANON_KEY: ${anonKey ? 'Set' : 'Missing'}`);
}

// Create the client only if both URL and key are available
const supabase = supabaseUrl && serviceRoleKey 
  ? createClient(supabaseUrl, serviceRoleKey)
  : createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '', 
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

// Create Supabase admin client with service role key for bypassing RLS
const supabaseAdmin = supabaseUrl && serviceRoleKey 
  ? createClient(supabaseUrl, serviceRoleKey)
  : createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '', 
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

// Log which keys we're using (without exposing the actual keys)
console.log(`Summarize API: Using ${anonKey ? 'anon' : 'missing'} key for regular client`);
console.log(`Summarize API: Using ${serviceRoleKey ? 'service role' : (anonKey ? 'anon' : 'missing')} key for admin client`);

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
  // If the input is empty or not a string, return a default object
  if (!text || typeof text !== 'string') {
    return { text: 'No content provided for summarization' };
  }
  
  try {
    // First try direct JSON parsing
    return JSON.parse(text);
  } catch (error) {
    console.error('JSON parse error:', error);
    console.log('Raw text that failed to parse:', text.substring(0, 200) + '...');
    
    // Try to extract JSON-like structure from the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (nestedError) {
        console.error('Nested JSON parse error:', nestedError);
      }
    }
    
    // Check if this is an OpenAI error message or apology
    if (text.includes("I'm sorry") || text.includes("error") || text.includes("invalid") || 
        text.includes("can't provide") || text.includes("no transcript")) {
      console.log('Detected OpenAI error message, creating structured response');
      return {
        text: text.length > 1000 ? text.substring(0, 1000) + '...' : text,
        error: 'OpenAI returned an error or could not process the request'
      };
    }
    
    // If all parsing fails, return a basic structure with the text
    // Truncate very long responses to a reasonable length
    const truncatedText = text.length > 1000 ? text.substring(0, 1000) + '...' : text;
    return { 
      text: truncatedText,
      error: 'Failed to parse response as JSON'
    };
  }
}

// Function to handle authentication and get the user ID
async function authenticateUser(accessToken: string | null): Promise<{ userId: string | null; error: string | null }> {
  // If no token provided, return null user ID but no error in development mode
  if (!accessToken) {
    console.log('No access token provided');
    if (process.env.NODE_ENV !== 'production') {
      console.log('DEVELOPMENT MODE: Proceeding without authentication');
      return { userId: null, error: null };
    }
    return { userId: null, error: 'Authentication required. Please sign in and try again.' };
  }
  
  try {
    // Verify the token with Supabase
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      
      // In development mode, we'll proceed without authentication
      if (process.env.NODE_ENV !== 'production') {
        console.log('DEVELOPMENT MODE: Proceeding despite authentication failure');
        return { userId: null, error: null };
      }
      
      return { 
        userId: null, 
        error: 'Authentication failed. Please sign in again or refresh the page to get a new session token.' 
      };
    }
    
    return { userId: user.id, error: null };
  } catch (error: any) {
    console.error('Authentication error:', error);
    
    // In development mode, we'll proceed without authentication
    if (process.env.NODE_ENV !== 'production') {
      console.log('DEVELOPMENT MODE: Proceeding despite authentication exception');
      return { userId: null, error: null };
    }
    
    return { userId: null, error: 'Authentication failed. Please sign in again.' };
  }
}

// Add a helper function to safely read the request body
async function safelyReadRequestBody(request: NextRequest) {
  try {
    // Log request details for debugging
    console.log('Summarize API: Received request with method:', request.method);
    console.log('Summarize API: Request headers:', Object.fromEntries(request.headers.entries()));
    
    // Clone the request to avoid consuming the body stream
    const clonedRequest = request.clone();
    
    try {
      // Try to read as JSON first
      const body = await request.json();
      console.log('Summarize API: Successfully parsed request body as JSON');
      return { body, error: null };
    } catch (jsonError) {
      console.error('Summarize API: Failed to parse request body as JSON:', jsonError);
      
      try {
        // Try to read as text as a fallback
        const textBody = await clonedRequest.text();
        console.log('Summarize API: Request body as text:', textBody.substring(0, 200) + (textBody.length > 200 ? '...' : ''));
        
        if (!textBody || textBody.trim() === '') {
          return { body: null, error: 'Empty request body' };
        }
        
        try {
          // Try to parse the text as JSON
          const parsedBody = JSON.parse(textBody);
          console.log('Summarize API: Successfully parsed text body as JSON');
          return { body: parsedBody, error: null };
        } catch (parseError: any) {
          console.error('Summarize API: Failed to parse text body as JSON:', parseError);
          return { body: null, error: `Invalid JSON: ${parseError.message || 'Unknown parsing error'}` };
        }
      } catch (textError: any) {
        console.error('Summarize API: Failed to read request body as text:', textError);
        return { body: null, error: `Failed to read request body: ${textError.message || 'Unknown error'}` };
      }
    }
  } catch (error: any) {
    console.error('Summarize API: Unexpected error reading request body:', error);
    return { body: null, error: `Unexpected error: ${error.message || 'Unknown error'}` };
  }
}

export async function POST(request: NextRequest) {
  console.log('Summarize API: Starting POST handler');
  
  // First, try to read the request as text to diagnose any issues
  let requestText;
  try {
    const clonedRequest = request.clone();
    requestText = await clonedRequest.text();
    console.log('Request body as text (first 100 chars):', requestText.substring(0, 100));
    
    if (!requestText || requestText.trim() === '') {
      console.error('Empty request body received');
      return NextResponse.json({ 
        success: false, 
        error: 'Empty request body',
        details: 'The request body was empty'
      }, { status: 400 });
    }
  } catch (textError: any) {
    console.error('Error reading request as text:', textError);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to read request body',
      details: textError.message || 'Unknown error'
    }, { status: 400 });
  }
  
  // Now try to parse the JSON
  let body;
  try {
    if (requestText) {
      // Parse the text we already read
      body = JSON.parse(requestText);
    } else {
      // Try direct JSON parsing as fallback
      body = await request.json();
    }
  } catch (parseError: any) {
    console.error('Error parsing request body as JSON:', parseError);
    return NextResponse.json({ 
      success: false, 
      error: 'Invalid JSON in request body',
      details: parseError.message || 'JSON parsing failed'
    }, { status: 400 });
  }
  
  try {
    const { transcriptionId, transcriptionText, accessToken } = body || {};
    
    console.log('Processing summary for transcription ID:', transcriptionId);
    
    // Validate required parameters
    if (!transcriptionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing transcription ID',
        details: 'transcriptionId is required'
      }, { status: 400 });
    }
    
    // Get the final token for authentication
    const authHeader = request.headers.get('Authorization');
    const finalAccessToken = accessToken || (authHeader ? authHeader.replace('Bearer ', '') : null);
    
    // Authenticate the user
    const { userId, error: authError } = await authenticateUser(finalAccessToken);
    
    // If authentication failed and we're in production, return error
    if (authError && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { 
          success: false,
          error: authError
        }, 
        { status: 401 }
      );
    }
    
    // Check if the transcription exists and get the current status
    const { data: transcription, error: fetchError } = await supabaseAdmin
      .from('transcriptions')
      .select('id, user_id, transcription_text, summary_status, summary_text, analysis_status, analysis_data, status')
      .eq('id', transcriptionId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching transcription:', fetchError);
      return NextResponse.json({ 
        success: false, 
        error: 'Transcription not found',
        details: fetchError.message 
      }, { status: 404 });
    }
    
    // Check if a summary is already in progress or completed
    if (transcription.summary_status === 'processing') {
      console.log(`Summary already in progress for transcription ${transcriptionId}, skipping duplicate request`);
      return NextResponse.json({ 
        success: true, 
        message: 'Summary generation already in progress',
        summary: transcription.summary_text || null
      });
    }
    
    if (transcription.summary_status === 'completed' && transcription.summary_text) {
      console.log(`Summary already completed for transcription ${transcriptionId}, returning existing summary`);
      return NextResponse.json({ 
        success: true, 
        message: 'Summary already exists',
        summary: transcription.summary_text
      });
    }
    
    // Update the summary status to processing
    const { error: updateError } = await supabaseAdmin
      .from('transcriptions')
      .update({
        summary_status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    if (updateError) {
      console.error('Error updating summary status:', updateError);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update summary status',
        details: updateError.message 
      }, { status: 500 });
    }
    
    // If we have a transcription ID, try to get the transcription text from the database
    let textToSummarize = transcriptionText;
    
    if (transcriptionId) {
      try {
        // Check if this transcription exists in the database
        const { data: transcription, error: transcriptionError } = await supabaseAdmin
          .from('transcriptions')
          .select('id, user_id, status, summary_status, summary_text, analysis_status, analysis_data, transcription_text')
          .eq('id', transcriptionId)
          .single();
        
        if (transcriptionError || !transcription) {
          console.error('Error fetching transcription:', transcriptionError);
          
          // If transcription text was provided directly, use that as fallback
          if (transcriptionText) {
            console.log('Using provided transcription text as fallback since record not found in database');
          } else {
            // Try to create a new transcription record if we have a user ID
            if (userId) {
              try {
                const { data: newTranscription, error: createError } = await supabaseAdmin
                  .from('transcriptions')
                  .insert({
                    id: transcriptionId,
                    user_id: userId,
                    status: 'completed',
                    summary_status: 'pending',
                    analysis_status: 'pending',
                    transcription_text: transcriptionText || '',
                    created_at: new Date().toISOString()
                  })
                  .select()
                  .single();
                
                if (createError) {
                  console.error('Failed to create new transcription record:', createError);
                }
              } catch (createErr) {
                console.error('Error creating transcription record:', createErr);
              }
            }
            
            if (!transcriptionText) {
              return NextResponse.json(
                { 
                  success: false,
                  error: 'Transcription not found',
                  details: 'Could not find transcription with the provided ID'
                }, 
                { status: 404 }
              );
            }
          }
        } else {
          // If we found the transcription, use its text
          textToSummarize = transcription.transcription_text;
          
          // Check if this transcription belongs to the authenticated user in production
          if (userId && transcription.user_id !== userId && process.env.NODE_ENV === 'production') {
            return NextResponse.json(
              { 
                success: false,
                error: 'Unauthorized',
                details: 'You can only summarize your own transcriptions'
              }, 
              { status: 403 }
            );
          }
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        
        // If transcription text was provided directly, use that as fallback
        if (!transcriptionText) {
          return NextResponse.json(
            { 
              success: false,
              error: 'Database error',
              details: 'Could not retrieve transcription from database'
            }, 
            { status: 500 }
          );
        } else {
          console.log('Using provided transcription text as fallback despite database error');
        }
      }
    }
    
    // If we still don't have text to summarize, return an error
    if (!textToSummarize) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Missing transcription text',
          details: 'No text to summarize was provided or found'
        }, 
        { status: 400 }
      );
    }
    
    // Prepare the prompt for OpenAI
    const systemPrompt = `
      You are an AI assistant specializing in summarizing interview transcripts. The user will provide a transcript from a recorded conversation or interview.
      
      Please provide a summary in JSON format with the following structure:
      {
        "text": "A concise 2-3 paragraph summary of the main points discussed in the transcript content",
        "keyPoints": ["A list of 3-5 bullet points highlighting the key takeaways from the actual conversation"],
        "topics": ["A list of main topics covered in the discussion"]
      }
      
      Keep your summary clear, accurate, and focused on the most important information from the actual conversation.
      
      IMPORTANT GUIDELINES:
      1. Focus on the actual content of the conversation, not the format or structure of the transcript.
      2. Do NOT comment on the quality, coherence, or structure of the transcript itself.
      3. If the transcript appears to be a processing message or placeholder (e.g., "Processing audio file" or "Using a transcription service"), respond with a placeholder summary.
      4. If the transcript is very short (less than 50 words) and appears to be incomplete, indicate that in your response.
      5. Assume the transcript is from a real conversation even if it seems disjointed - focus on extracting meaning rather than critiquing the transcript.
      
      If and ONLY if the transcript is clearly just a processing message or placeholder (contains phrases like "processing your audio" or "transcription in progress"), respond with:
      {
        "text": "This appears to be a processing message or very short transcript. Please wait for the complete transcription to be available.",
        "keyPoints": ["Waiting for complete transcription"],
        "topics": ["Processing"]
      }
    `;
    
    // Check if the text is a processing message
    const processingPhrases = [
      'processing your audio',
      'processing audio file',
      'being processed',
      'may take several minutes',
      'using rev.ai',
      'transcription in progress'
    ];
    
    const isProcessingMessage = processingPhrases.some(phrase => 
      textToSummarize.toLowerCase().includes(phrase.toLowerCase())
    ) || textToSummarize.length < 50;
    
    if (isProcessingMessage) {
      console.log('Detected processing message, returning placeholder summary');
      
      // Create a placeholder summary
      const placeholderSummary = {
        text: "This appears to be a processing message or very short transcript. Please wait for the complete transcription to be available.",
        keyPoints: ["Waiting for complete transcription"],
        topics: ["Processing"]
      };
      
      // Update the database with the processing status and placeholder summary
      try {
        const { error: updateError } = await supabaseAdmin
          .from('transcriptions')
          .update({
            summary_text: placeholderSummary.text,
            summary_status: 'completed', // Mark as completed so the tab is enabled
            updated_at: new Date().toISOString()
          })
          .eq('id', transcriptionId);
          
        if (updateError) {
          console.error('Error updating with placeholder summary:', updateError);
        } else {
          console.log('Successfully updated with placeholder summary');
        }
      } catch (updateError) {
        console.error('Error updating summary status:', updateError);
      }
      
      // Return a placeholder summary response
      return NextResponse.json({
        success: true,
        summary: placeholderSummary,
        isPlaceholder: true
      });
    }
    
    // Set a timeout for the OpenAI request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      // Call OpenAI for summarization
      let completion;
      let modelUsed = "gpt-4";
      
      try {
        // Try with GPT-4 first
        completion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Please summarize the following transcript:\n\n${textToSummarize}` }
          ],
          temperature: 0.3,
          max_tokens: 800
        }, { signal: controller.signal });
      } catch (error: any) {
        // Check if this is a rate limit error
        if (error.status === 429 || (error.message && error.message.includes('rate limit'))) {
          console.log('Rate limit reached for GPT-4, falling back to GPT-3.5-turbo');
          
          // Fall back to GPT-3.5-turbo
          modelUsed = "gpt-3.5-turbo";
          completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Please summarize the following transcript:\n\n${textToSummarize}` }
            ],
            temperature: 0.3,
            max_tokens: 800
          }, { signal: controller.signal });
        } else {
          // Re-throw other errors
          throw error;
        }
      }
      
      // Clear the timeout if we get a response
      clearTimeout(timeoutId);
      
      // Process the response
      const responseContent = completion.choices[0]?.message?.content || '';
      console.log(`Raw response from OpenAI (${modelUsed}):`, responseContent.substring(0, 200) + '...');
      
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
      console.log(`Updating transcription ${transcriptionId} with summary text (length: ${summaryData.text.length})`);
      
      let dbUpdateSuccess = true;
      let dbUpdateError = null;
      
      try {
        // First, check if the transcription record exists
        const { data: transcriptionRecord, error: fetchError } = await supabaseAdmin
          .from('transcriptions')
          .select('id, summary_text, summary_status')
          .eq('id', transcriptionId)
          .single();
          
        if (fetchError) {
          console.error('Error fetching transcription record:', fetchError);
          dbUpdateSuccess = false;
          dbUpdateError = fetchError;
        } else {
          console.log('Found transcription record:', transcriptionRecord);
          
          // Now update the record with the summary
          const { error } = await supabaseAdmin
            .from('transcriptions')
            .update({
              summary_text: summaryData.text,
              summary_status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);

          if (error) {
            console.error('Error updating summary:', error);
            dbUpdateSuccess = false;
            dbUpdateError = error;
            
            // Try a simplified update approach
            console.log('Attempting simplified update...');
            const { error: retryError } = await supabaseAdmin
              .from('transcriptions')
              .update({
                summary_text: summaryData.text,
                summary_status: 'completed'
              })
              .eq('id', transcriptionId);
              
            if (retryError) {
              console.error('Simplified update also failed:', retryError);
            } else {
              console.log('Simplified update succeeded');
              dbUpdateSuccess = true;
              dbUpdateError = null;
            }
          } else {
            console.log('Summary updated successfully');
            
            // Verify the update was successful by fetching the record again
            const { data: verifiedRecord, error: verifyError } = await supabaseAdmin
              .from('transcriptions')
              .select('id, summary_text, summary_status')
              .eq('id', transcriptionId)
              .single();
              
            if (verifyError) {
              console.error('Error verifying update:', verifyError);
            } else {
              console.log('Verified record:', {
                id: verifiedRecord.id,
                summary_status: verifiedRecord.summary_status,
                summary_text_length: verifiedRecord.summary_text?.length || 0
              });
              
              if (!verifiedRecord.summary_text) {
                console.warn('Warning: summary_text is still null after update!');
                dbUpdateSuccess = false;
              }
            }
          }
        }
      } catch (error) {
        console.error('Unexpected error updating summary:', error);
        dbUpdateSuccess = false;
        dbUpdateError = error;
      }

      // Return the summary data
      return NextResponse.json({
        success: true,
        summary: summaryData,
        dbUpdateSuccess,
        dbUpdateError: dbUpdateError ? String(dbUpdateError) : null
      });
      
    } catch (openaiError: any) {
      // Clear the timeout if there was an error
      clearTimeout(timeoutId);
      
      console.error('OpenAI summarization error:', openaiError);
      
      // Check if this was an abort error (timeout)
      if (openaiError.name === 'AbortError' || openaiError.code === 'ETIMEDOUT') {
        console.error('Summary generation timed out after 2 minutes');
        
        await supabaseAdmin
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
        await supabaseAdmin
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
    
    // Ensure the error response is valid JSON
    return NextResponse.json({ 
      success: false,
      error: 'An unexpected error occurred',
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}

// Configure response options
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    externalResolver: true, // This tells Next.js that this route will handle its own errors
  },
  fetchCache: 'force-no-store',
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
};
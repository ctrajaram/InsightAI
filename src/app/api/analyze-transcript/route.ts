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
  pain_points?: string[];
  feature_requests?: string[];
  sentiment_explanation?: string;
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

// Helper functions for sentiment analysis
function getMostFrequentSentiment(sentiments: (string | undefined)[]): string {
  const filtered = sentiments.filter(s => s) as string[];
  if (filtered.length === 0) return 'neutral';
  
  const counts = filtered.reduce((acc, sentiment) => {
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Find the sentiment with the highest count
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || 'neutral';
}

function combineExplanations(explanations: (string | undefined)[]): string {
  // Join non-empty explanations
  const filtered = explanations.filter(e => e) as string[];
  if (filtered.length === 0) return 'No explanation available';
  
  // If there's only one, return it
  if (filtered.length === 1) return filtered[0];
  
  // Otherwise create a summarized version
  return `Summary of findings: ${filtered.join(' ')}`;
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
          console.error(`Transcription with ID ${transcriptionId} not found`);
          console.log('Creating new transcription record with provided text');
          
          // Create a new transcription record if it doesn't exist
          try {
            const { data: newTranscription, error: createError } = await supabase
              .from('transcriptions')
              .insert({
                id: transcriptionId,
                user_id: user.id,
                transcription_text: transcriptionText,
                status: 'completed',
                analysis_status: 'processing',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();
              
            if (createError) {
              console.error('Failed to create new transcription record:', createError);
              // Continue with a temporary record
              transcription = {
                id: transcriptionId,
                user_id: user.id,
                transcription_text: transcriptionText,
                status: 'completed',
                analysis_status: 'processing',
                summary_status: 'pending'
              };
            } else {
              console.log('Created new transcription record:', newTranscription.id);
              transcription = newTranscription;
            }
          } catch (createError) {
            console.error('Exception creating transcription record:', createError);
            // Continue with a temporary record
            transcription = {
              id: transcriptionId,
              user_id: user.id,
              transcription_text: transcriptionText,
              status: 'completed',
              analysis_status: 'processing',
              summary_status: 'pending'
            };
          }
        } else {
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
    }
    
    if (transcription === null || transcription === undefined) {
      console.error(`Transcription with ID ${transcriptionId} not found`);
      console.log('Creating new transcription record with provided text');
      
      // Create a new transcription record if it doesn't exist
      try {
        const { data: newTranscription, error: createError } = await supabase
          .from('transcriptions')
          .insert({
            id: transcriptionId,
            user_id: user.id,
            transcription_text: transcriptionText,
            status: 'completed',
            analysis_status: 'processing',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();
          
        if (createError) {
          console.error('Failed to create new transcription record:', createError);
          // Continue with a temporary record
          transcription = {
            id: transcriptionId,
            user_id: user.id,
            transcription_text: transcriptionText,
            status: 'completed',
            analysis_status: 'processing',
            summary_status: 'pending'
          };
        } else {
          console.log('Created new transcription record:', newTranscription.id);
          transcription = newTranscription;
        }
      } catch (createError) {
        console.error('Exception creating transcription record:', createError);
        // Continue with a temporary record
        transcription = {
          id: transcriptionId,
          user_id: user.id,
          transcription_text: transcriptionText,
          status: 'completed',
          analysis_status: 'processing',
          summary_status: 'pending'
        };
      }
    }
    
    // At this point, transcription should never be null due to our fallback mechanisms
    // But let's add a type assertion to satisfy TypeScript
    if (transcription!.user_id !== user.id) {
      console.error(`Unauthorized: User ${user.id} attempted to access transcription owned by ${transcription!.user_id}`);
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
        "questions": ["Important questions raised during the conversation"],
        "pain_points": ["List of pain points or challenges mentioned"],
        "feature_requests": ["List of feature requests or suggestions mentioned"],
        "sentiment_explanation": "Explanation of the sentiment detected"
      }
      
      Keep your analysis factual, concise, and directly based on content from the transcript.
    `;
    
    // Set a timeout for the OpenAI request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 240000); // 4 minute timeout
    
    try {
      // Check if transcript is too large and needs chunking
      const MAX_CHUNK_SIZE = 12000; // About 12k tokens max
      let analysisData: AnalysisData;
      
      if (transcriptionText.length > MAX_CHUNK_SIZE) {
        console.log(`Transcript length (${transcriptionText.length} chars) exceeds chunk size limit. Implementing chunked analysis.`);
        
        // Split the transcript into chunks
        const chunks = [];
        for (let i = 0; i < transcriptionText.length; i += MAX_CHUNK_SIZE) {
          chunks.push(transcriptionText.substring(i, i + MAX_CHUNK_SIZE));
        }
        console.log(`Split transcript into ${chunks.length} chunks for analysis`);
        
        // Process each chunk separately
        const chunkResults: AnalysisData[] = [];
        
        for (const [index, chunk] of chunks.entries()) {
          console.log(`Processing chunk ${index + 1}/${chunks.length}...`);
          
          try {
            const chunkCompletion = await openai.chat.completions.create({
              model: "gpt-3.5-turbo", // Use 3.5-turbo for faster processing of chunks
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Please analyze the following part (${index + 1}/${chunks.length}) of a transcript:\n\n${chunk}` }
              ],
              temperature: 0.3,
              max_tokens: 600
            }, { signal: controller.signal });
            
            const responseText = chunkCompletion.choices[0].message.content || '';
            const chunkData = safelyParseJSON(responseText) as AnalysisData;
            
            if (chunkData) {
              chunkResults.push(chunkData);
            }
          } catch (chunkError: any) {
            console.error(`Error processing chunk ${index + 1}:`, chunkError.message);
            // Continue with other chunks even if one fails
          }
        }
        
        // Combine results from all chunks
        analysisData = {
          topics: Array.from(new Set(chunkResults.flatMap(r => r.topics || []))),
          keyInsights: Array.from(new Set(chunkResults.flatMap(r => r.keyInsights || []))),
          actionItems: Array.from(new Set(chunkResults.flatMap(r => r.actionItems || []))),
          questions: Array.from(new Set(chunkResults.flatMap(r => r.questions || []))),
          pain_points: Array.from(new Set(chunkResults.flatMap(r => r.pain_points || []))),
          feature_requests: Array.from(new Set(chunkResults.flatMap(r => r.feature_requests || []))),
          // For sentiment, use the most frequent sentiment across chunks
          sentiment: getMostFrequentSentiment(chunkResults.map(r => r.sentiment)),
          sentiment_explanation: combineExplanations(chunkResults.map(r => r.sentiment_explanation)),
          toneAnalysis: combineExplanations(chunkResults.map(r => r.toneAnalysis))
        };
        
        console.log('Combined analysis data from chunks');
      } else {
        // For smaller transcripts, process normally
        const completion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Please analyze the following transcript:\n\n${transcriptionText}` }
          ],
          temperature: 0.3,
          max_tokens: 800
        }, { signal: controller.signal });
        
        // Parse the response from OpenAI
        console.log('Raw response from OpenAI:', completion.choices[0].message.content);
        const responseText = completion.choices[0].message.content || '';
        analysisData = safelyParseJSON(responseText) as AnalysisData;
      }
      
      // Clear the timeout if we get a response
      clearTimeout(timeoutId);
      
      // Normalize sentiment values to ensure consistency
      if (analysisData.sentiment) {
        const sentiment = analysisData.sentiment.toLowerCase();
        if (sentiment.includes('positive')) {
          analysisData.sentiment = 'positive';
        } else if (sentiment.includes('negative')) {
          analysisData.sentiment = 'negative';
        } else {
          analysisData.sentiment = 'neutral';
        }
        console.log('Normalized sentiment:', analysisData.sentiment);
      } else {
        // If sentiment is missing, add a default value
        console.log('No sentiment found in response, adding default');
        analysisData.sentiment = 'neutral';
        analysisData.sentiment_explanation = 'No clear sentiment detected in the transcript.';
      }
      
      // Ensure pain_points and feature_requests are arrays
      if (!Array.isArray(analysisData.pain_points)) {
        analysisData.pain_points = [];
      }
      
      if (!Array.isArray(analysisData.feature_requests)) {
        analysisData.feature_requests = [];
      }
      
      // Stringify the analysis data for database storage
      const analysisDataString = JSON.stringify(analysisData);
      console.log('Processed analysis data:', analysisDataString);
      
      // Update transcription record with analysis data
      try {
        await retryOperation(async () => {
          const { error } = await supabase
            .from('transcriptions')
            .update({
              analysis_data: analysisData,
              analysis_status: 'completed', // Explicitly set status to completed
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
          
          if (error) {
            console.error('Error updating transcription with analysis:', error);
            throw error;
          }
        });
        
        console.log('Successfully updated transcription with analysis');
        
        // Verify the update was successful
        const { data: verifyData, error: verifyError } = await supabase
          .from('transcriptions')
          .select('id, analysis_status, analysis_data')
          .eq('id', transcriptionId)
          .single();
          
        if (verifyError) {
          console.error('Error verifying analysis update:', verifyError);
        } else {
          console.log('Verified analysis status:', verifyData.analysis_status);
          
          // If status is still not completed, try one more direct update
          if (verifyData.analysis_status !== 'completed') {
            console.log('Analysis status not showing as completed, attempting direct update...');
            
            const { error: directUpdateError } = await supabase
              .from('transcriptions')
              .update({
                analysis_status: 'completed'
              })
              .eq('id', transcriptionId);
              
            if (directUpdateError) {
              console.error('Direct update of analysis status failed:', directUpdateError);
            } else {
              console.log('Direct update of analysis status successful');
            }
          }
        }
      } catch (updateError) {
        console.error('Failed to update transcription with analysis:', updateError);
      }
      
      // Return the success response with analysis
      return NextResponse.json({
        success: true,
        analysis: analysisData,
        message: 'Analysis completed successfully'
      });
      
    } catch (openaiError: any) {
      // Clear the timeout if there was an error
      clearTimeout(timeoutId);
      
      console.error('OpenAI analysis error:', openaiError);
      
      // Check if this was an abort error (timeout)
      if (openaiError.name === 'AbortError' || openaiError.code === 'ETIMEDOUT') {
        console.error('Analysis generation timed out after 4 minutes');
        
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

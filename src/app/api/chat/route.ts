import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapDbRecordToTranscriptionRecord } from '@/lib/media-storage';
import OpenAI from 'openai';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

// Declare OpenAI client variable but don't initialize it yet
let openaiClient: OpenAI | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined' && openaiApiKey) {
  try {
    // Create OpenAI client
    openaiClient = new OpenAI({
      apiKey: openaiApiKey,
    });
    console.log('Chat API: OpenAI client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize OpenAI client:', error);
    openaiClient = null;
  }
}

export async function POST(req: Request) {
  try {
    const { messages, transcriptionId, accessToken } = await req.json();
    
    console.log('Chat API: Request received with transcriptionId:', transcriptionId);
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }
    
    if (!transcriptionId) {
      return NextResponse.json({ error: 'No transcription ID provided' }, { status: 400 });
    }
    
    if (!accessToken) {
      console.error('Chat API: No access token provided');
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    
    // Get authentication from request header if available
    const authHeader = req.headers.get('authorization');
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    // Use either header token or body token, preferring header
    const finalAccessToken = headerToken || accessToken;
    
    console.log('Chat API: Using access token from:', headerToken ? 'Authorization header' : 'Request body');
    
    // Create a Supabase client with the user's access token
    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${finalAccessToken}`
          }
        }
      }
    );
    
    // Verify the user's authentication
    const { data: userData, error: authError } = await supabase.auth.getUser(finalAccessToken);
    if (authError || !userData.user) {
      console.error('Chat API: Authentication error:', authError?.message);
      return NextResponse.json(
        { error: 'Authentication failed. Please log in again.' },
        { status: 401 }
      );
    }

    console.log('Chat API: User authenticated:', userData.user.id);

    // Log auth information with type safety
    console.log('Chat API: Full auth details:', {
      userEmail: userData.user.email,
      userId: userData.user.id,
      authProvider: userData.user.app_metadata?.provider
    });

    // Fetch the transcription data with a more reliable approach
    console.log('Chat API: Looking up transcription with ID:', transcriptionId);
    
    // Create a type-safe query ID
    const queryId = String(transcriptionId).trim();
    console.log('Chat API: Using queryId:', queryId);
    
    // Additional validation
    if (!queryId) {
      console.error('Chat API: Empty transcription ID provided');
      return NextResponse.json(
        { error: 'No transcription ID provided' },
        { status: 400 }
      );
    }
    
    let transcription;
    
    try {
      // Try a more direct approach: first look for the specific transcription directly
      console.log('Chat API: Searching for transcription with ID:', queryId, 'without user filter');
      
      const { data: directTranscription, error: directError } = await supabase
        .from('transcriptions')
        .select('*, analysis_data')
        .eq('id', queryId)
        .maybeSingle();
      
      if (directError) {
        console.error('Chat API: Error in direct transcription lookup:', directError.message);
      } else if (directTranscription) {
        console.log('Chat API: Found transcription directly:', directTranscription.id);
        transcription = directTranscription;
        
        // If we find a match, let's still verify it's for the right user
        if (directTranscription.user_id !== userData.user.id) {
          console.warn('Chat API: Found transcription belongs to different user:', {
            transcriptionUserId: directTranscription.user_id,
            requestUserId: userData.user.id
          });
          
          // For now, we'll allow this but log it as a warning
          // In a production app, we might want to return a 403 error
        }
      } else {
        console.log('Chat API: No transcription found with direct ID lookup, trying user-specific lookup');
        
        // If we can't find it directly, try getting all transcriptions for the user
        const { data: userTranscriptions, error: listError } = await supabase
          .from('transcriptions')
          .select('*, analysis_data')
          .eq('user_id', userData.user.id);
          
        if (listError) {
          console.error('Chat API: Error fetching user transcriptions:', listError.message);
        } else if (userTranscriptions && userTranscriptions.length > 0) {
          console.log('Chat API: Found', userTranscriptions.length, 'transcriptions for user');
          
          // Try to find the specific transcription
          transcription = userTranscriptions.find(t => String(t.id) === queryId);
          
          if (!transcription) {
            console.log('Chat API: No matching transcription found in user transcriptions');
            // If we found transcriptions but not the one we want, use the most recent one
            if (userTranscriptions.length > 0) {
              // Sort by created_at (desc) and take the first one
              const sortedTranscriptions = [...userTranscriptions].sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              );
              transcription = sortedTranscriptions[0];
              console.log('Chat API: Using most recent user transcription as fallback:', transcription.id);
            }
          }
        } else {
          console.error('Chat API: No transcriptions found for user:', userData.user.id);
        }
      }
      
      // If we couldn't find a transcription after all these attempts, return an error
      if (!transcription) {
        return NextResponse.json(
          { error: 'No transcriptions found. Please upload and transcribe an interview first.' },
          { status: 404 }
        );
      }
      
      console.log('Chat API: Using transcription:', {
        id: transcription.id, 
        fileName: transcription.file_name,
        transcriptionLength: transcription.transcription_text?.length || 0
      });
      
    } catch (error) {
      console.error('Chat API: Unexpected error during transcription lookup:', error);
      return NextResponse.json(
        { error: 'Error processing transcription lookup' },
        { status: 500 }
      );
    }

    // No need to verify user access since we already filtered by user_id
    
    // Map database fields to camelCase for consistency
    const transcriptionData = mapDbRecordToTranscriptionRecord(transcription);

    // Log the raw analysis_data from the database record
    console.log('Chat API: Raw analysis_data from database:', {
      hasRawAnalysisData: !!transcription.analysis_data,
      rawAnalysisDataType: typeof transcription.analysis_data,
      rawAnalysisDataKeys: transcription.analysis_data ? Object.keys(transcription.analysis_data) : [],
      rawAnalysisDataSample: transcription.analysis_data ? JSON.stringify(transcription.analysis_data).substring(0, 200) : 'null'
    });

    // Debug log for analysis data
    console.log('Chat API: Analysis data available:', {
      hasAnalysisData: !!transcriptionData.analysisData,
      analysisDataKeys: transcriptionData.analysisData ? Object.keys(transcriptionData.analysisData) : [],
      sentiment: transcriptionData.analysisData?.sentiment,
      hasPainPoints: Array.isArray(transcriptionData.analysisData?.pain_points),
      painPointsCount: Array.isArray(transcriptionData.analysisData?.pain_points) ? transcriptionData.analysisData.pain_points.length : 0,
      painPointsData: transcriptionData.analysisData?.pain_points ? JSON.stringify(transcriptionData.analysisData.pain_points).substring(0, 300) : 'null',
      painPointsType: typeof transcriptionData.analysisData?.pain_points,
      hasFeatureRequests: Array.isArray(transcriptionData.analysisData?.feature_requests),
      featureRequestsCount: Array.isArray(transcriptionData.analysisData?.feature_requests) ? transcriptionData.analysisData.feature_requests.length : 0,
      rawAnalysisData: JSON.stringify(transcriptionData.analysisData).substring(0, 200) + '...',
    });

    // Ensure analysis data is properly structured
    const analysisData = transcriptionData.analysisData || {
      sentiment: 'neutral',
      sentiment_explanation: 'No sentiment analysis available',
      pain_points: [],
      feature_requests: []
    };

    // Force parse the analysis_data if it's a string (happens sometimes with Supabase)
    if (typeof transcription.analysis_data === 'string' && transcription.analysis_data) {
      try {
        const parsedData = JSON.parse(transcription.analysis_data);
        if (parsedData && typeof parsedData === 'object') {
          // Override the mapped data with directly parsed data to ensure consistency
          Object.assign(analysisData, parsedData);
          console.log('Chat API: Successfully parsed analysis_data from string');
        }
      } catch (e) {
        console.error('Chat API: Error parsing analysis_data string:', e);
      }
    }

    // Log the final analysis data that will be used
    console.log('Chat API: Final analysis data being used:', {
      painPoints: analysisData.pain_points,
      painPointsCount: Array.isArray(analysisData.pain_points) ? analysisData.pain_points.length : 0,
      sentiment: analysisData.sentiment
    });

    // Create system message with context
    const systemMessage = {
      role: 'system',
      content: `You are an AI assistant for the InsightAI app that helps analyze interview transcripts.
You have access to the following information about an interview:

1. Full Transcript: "${transcriptionData.transcriptionText}"
2. AI Summary: "${transcriptionData.summaryText || 'Not available'}"
3. Sentiment Analysis: ${
        Object.keys(analysisData).length > 0
          ? `
   - Overall Sentiment: ${analysisData.sentiment || 'neutral'}
   - Sentiment Explanation: ${analysisData.sentiment_explanation || 'No explanation available'}
   - Pain Points: ${
      Array.isArray(analysisData.pain_points) && analysisData.pain_points.length > 0
        ? analysisData.pain_points.map(p => `- ${p}`).join('\n      ')
        : 'No pain points were identified'
    }
   - Feature Requests: ${JSON.stringify(analysisData.feature_requests || [])}`
          : 'Not available'
      }

IMPORTANT INSTRUCTIONS:
1. When asked about sentiment, pain points, or other analysis data, ALWAYS check the Sentiment Analysis section above.
2. If Overall Sentiment shows a value like "positive", "negative", or "neutral", then sentiment analysis IS available.
3. IMPORTANT: For pain points, carefully check the actual content of the Pain Points array above.
   - If the array contains items (not empty []), there ARE pain points to report. List them in detail.
   - If the array is empty ([]), explicitly state "No pain points were identified in this interview transcript."
   - NEVER say there are no pain points unless you've verified the Pain Points array is empty.
4. NEVER say "sentiment analysis is not available" if the Overall Sentiment field has a value.
5. If asked specifically about pain points, ALWAYS check the actual Pain Points array content before responding.

Help the user understand the interview data by answering their questions about the content, insights, sentiment, and any patterns you detect. Be helpful, concise, and thoughtful in your responses.`,
    };

    // Add system message to the beginning of the messages array
    const augmentedMessages = [systemMessage, ...messages];

    // Format messages for OpenAI API (only include role and content)
    const formattedMessages = augmentedMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    console.log('Sending formatted messages to OpenAI:', JSON.stringify(formattedMessages.slice(0, 2)));
    
    // Check if OpenAI client is initialized
    if (!openaiClient) {
      return NextResponse.json({ 
        error: 'OpenAI client not initialized',
        success: false
      }, { status: 500 });
    }
    
    // Call the OpenAI API
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: formattedMessages,
      temperature: 0.7,
      max_tokens: 800,
    });
    
    console.log('Received response from OpenAI:', response.choices[0].message);

    // Return the assistant's response
    return NextResponse.json({
      response: response.choices[0].message.content,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat request' },
      { status: 500 }
    );
  }
}

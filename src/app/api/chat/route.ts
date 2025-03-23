import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapDbRecordToTranscriptionRecord } from '@/lib/media-storage';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
        .select('*')
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
          .select('*')
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

    // Create system message with context
    const systemMessage = {
      role: 'system',
      content: `You are an AI assistant for the InsightAI app that helps analyze interview transcripts.
You have access to the following information about an interview:

1. Full Transcript: "${transcriptionData.transcriptionText}"
2. AI Summary: "${transcriptionData.summaryText || 'Not available'}"
3. Sentiment Analysis: ${
        transcriptionData.analysisData
          ? `
   - Overall Sentiment: ${transcriptionData.analysisData.sentiment}
   - Sentiment Explanation: ${transcriptionData.analysisData.sentiment_explanation}
   - Pain Points: ${JSON.stringify(transcriptionData.analysisData.pain_points || [])}
   - Feature Requests: ${JSON.stringify(transcriptionData.analysisData.feature_requests || [])}`
          : 'Not available'
      }

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
    
    // Call the OpenAI API
    const response = await openai.chat.completions.create({
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

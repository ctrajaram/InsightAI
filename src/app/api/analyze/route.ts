import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set a longer timeout for this route (5 minutes)
export const maxDuration = 300; // 5 minutes in seconds (maximum allowed on Vercel Pro plan)

// Set a larger body size limit
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};

// Maximum text length to analyze
const MAX_TEXT_LENGTH = 15000;

export async function POST(req: Request) {
  console.log('Analysis API: Starting POST handler');
  
  try {
    // Log request headers to help debug
    const headers = Object.fromEntries(req.headers.entries());
    console.log('Request headers:', JSON.stringify(headers, null, 2));
    
    // Check if the request body is empty
    const contentLength = req.headers.get('content-length');
    console.log('Content-Length header:', contentLength);
    
    if (!contentLength || parseInt(contentLength) === 0) {
      console.error('Empty request body received (content-length is 0 or missing)');
      return NextResponse.json({
        success: false,
        error: 'Empty request body',
      }, { status: 400 });
    }
    
    // Parse the request body
    let body;
    let bodyText = '';
    
    try {
      // Clone the request before reading it as text
      const clonedReq = req.clone();
      
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
          }, { status: 400 });
        }
        
        // Parse the text as JSON
        try {
          body = JSON.parse(bodyText);
          console.log('Successfully parsed request body:', JSON.stringify(body, null, 2));
        } catch (jsonError) {
          console.error('Failed to parse request body as JSON:', jsonError, 'Raw body:', bodyText);
          return NextResponse.json({
            success: false,
            error: 'Invalid JSON in request body',
            details: jsonError instanceof Error ? jsonError.message : 'Unknown parsing error'
          }, { status: 400 });
        }
      } catch (textError) {
        console.error('Failed to read request as text:', textError);
        
        try {
          // If text reading fails, try with json() directly on the original request
          const fallbackReq = req.clone();
          body = await fallbackReq.json();
          console.log('Successfully parsed request body using json() method:', JSON.stringify(body, null, 2));
        } catch (jsonError) {
          console.error('Failed to parse request body as JSON after text failure:', jsonError);
          return NextResponse.json({
            success: false,
            error: 'Invalid or empty request body',
            details: jsonError instanceof Error ? jsonError.message : 'Unknown parsing error'
          }, { status: 400 });
        }
      }
    } catch (error) {
      console.error('Unexpected error processing request body:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to process request body',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 400 });
    }
    
    const { transcriptionId, accessToken } = body || {};
    
    // Validate required parameters
    if (!transcriptionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required parameter: transcriptionId' 
      }, { status: 400 });
    }
    
    // Set up Supabase clients
    let supabase;
    let supabaseAdmin;
    
    try {
      // Initialize Supabase client with user token if provided
      if (accessToken) {
        console.log('Analysis API: Using user token for authentication');
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
          }
        );
      } else {
        console.log('Analysis API: Using anon key for regular client');
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );
      }
      
      // Always initialize admin client with service role for database operations
      console.log('Analysis API: Using service role key for admin client');
      supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || ''
      );
    } catch (error) {
      console.error('Error initializing Supabase clients:', error);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to initialize database connection' 
      }, { status: 500 });
    }
    
    // Check if the transcription exists and get the current status
    const { data: transcription, error: fetchError } = await supabaseAdmin
      .from('transcriptions')
      .select('id, user_id, transcription_text, analysis_status, analysis_data, status, summary_status, summary_text')
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
    
    // Check if there's a summary to use for the analysis
    let summaryText = '';
    if (transcription.summary_text && transcription.summary_status === 'completed') {
      console.log('Using existing summary for analysis');
      summaryText = transcription.summary_text;
    }
    
    // Check if transcription is complete
    if (transcription.status !== 'completed') {
      console.log(`Transcription ${transcriptionId} is not complete (status: ${transcription.status}), cannot analyze`);
      
      // Return a more informative error response with a 202 Accepted status instead of 400 Bad Request
      // This indicates the request was valid but is still being processed
      return NextResponse.json({
        success: false,
        error: 'Transcription is still processing',
        status: transcription.status,
        retryAfter: 10, // Suggest client retry after 10 seconds
        isPartial: true
      }, { status: 202 }); // 202 Accepted is more appropriate than 400 Bad Request
    }
    
    // If there's no transcription text, we can't analyze it
    if (!transcription.transcription_text || transcription.transcription_text.trim().length === 0) {
      console.log(`Transcription ${transcriptionId} has no text, cannot analyze`);
      return NextResponse.json({ 
        success: false, 
        error: 'Transcription has no text',
        details: 'Transcription text is empty or missing'
      }, { status: 400 });
    }
    
    // Update the analysis status to processing
    const { error: updateError } = await supabaseAdmin
      .from('transcriptions')
      .update({
        analysis_status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    if (updateError) {
      console.error('Error updating analysis status:', updateError);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update analysis status',
        details: updateError.message 
      }, { status: 500 });
    }
    
    // If transcription text is provided directly, use it
    let finalTranscriptionText = '';
    
    if (transcription.transcription_text && typeof transcription.transcription_text === 'string') {
      console.log('Using provided transcription text');
      finalTranscriptionText = transcription.transcription_text;
    } else {
      // Otherwise, fetch from database
      console.log('Querying for transcription with ID:', transcriptionId);
      const { data: transcription, error: directError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', transcriptionId)
        .single();
        
      if (directError) {
        console.error('Error fetching transcription:', directError);
        return NextResponse.json({ 
          error: 'Transcription not found',
          details: directError.message || 'No matching record found with ID: ' + transcriptionId
        }, { status: 404 });
      }

      if (!transcription) {
        console.error('No transcription found with ID:', transcriptionId);
        return NextResponse.json({ 
          error: 'Transcription not found',
          details: 'No matching record found with ID: ' + transcriptionId
        }, { status: 404 });
      }

      console.log('Found transcription record:', transcription);

      // Check if transcription text exists - use the field name from the database
      finalTranscriptionText = transcription.transcription_text;
      if (!finalTranscriptionText) {
        console.error('Transcription text is empty in record:', transcription);
        return NextResponse.json({ error: 'Transcription text is empty' }, { status: 400 });
      }
    }

    // Truncate text if it's too long to avoid timeouts
    let textToAnalyze = finalTranscriptionText;
    if (finalTranscriptionText.length > MAX_TEXT_LENGTH) {
      console.log(`Transcription text too long (${finalTranscriptionText.length} chars), truncating to ${MAX_TEXT_LENGTH} chars`);
      
      // Take the first part, middle part, and last part to get a representative sample
      const firstPart = finalTranscriptionText.substring(0, MAX_TEXT_LENGTH * 0.5);
      const middlePart = finalTranscriptionText.substring(
        Math.floor(finalTranscriptionText.length / 2 - MAX_TEXT_LENGTH * 0.25),
        Math.floor(finalTranscriptionText.length / 2 + MAX_TEXT_LENGTH * 0.25)
      );
      const lastPart = finalTranscriptionText.substring(
        finalTranscriptionText.length - MAX_TEXT_LENGTH * 0.25
      );
      
      textToAnalyze = `${firstPart}\n\n[...middle content omitted...]\n\n${middlePart}\n\n[...more content omitted...]\n\n${lastPart}`;
    }

    // Verify we have text to analyze
    if (!textToAnalyze || textToAnalyze.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No transcription text provided for analysis'
      }, { status: 400 });
    }

    // Skip analysis if the text appears to be a processing message
    const processingPhrases = [
      'processing your audio',
      'processing audio file',
      'being processed',
      'may take several minutes',
      'using rev.ai',
      'transcription in progress'
    ];
    
    const isProcessingMessage = processingPhrases.some(phrase => 
      textToAnalyze.toLowerCase().includes(phrase.toLowerCase())
    ) || textToAnalyze.length < 50;
    
    if (isProcessingMessage) {
      console.log('Detected processing message, returning placeholder analysis');
      
      // Return a placeholder analysis response
      return NextResponse.json({
        success: true,
        analysis: {
          topics: ["Processing"],
          keyInsights: ["Waiting for complete transcription"],
          actionItems: [],
          sentiment: "neutral",
          toneAnalysis: "This appears to be a processing message, not actual content",
          questions: [],
          pain_points: [],
          feature_requests: [],
          sentiment_explanation: "This is a system message, not actual conversation content"
        }
      });
    }

    // Prepare the prompt for OpenAI
    const systemPrompt = `
      You are an AI assistant specializing in analyzing interview transcripts. The user will provide a transcript from a recorded conversation or interview.
      
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
      
      IMPORTANT GUIDELINES:
      1. Focus on the actual content of the conversation, not the format or structure of the transcript.
      2. Do NOT comment on the quality, coherence, or structure of the transcript itself.
      3. Assume the transcript is from a real conversation even if it seems disjointed - focus on extracting meaning rather than critiquing the transcript.
      4. Be factual and objective in your analysis, based solely on the content provided.
      5. If a category doesn't apply (e.g., no action items mentioned), provide an empty array for that category.
      
      Keep your analysis factual, concise, and directly based on content from the transcript.
    `;

    // Call OpenAI API with optimized parameters
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      // Call OpenAI for analysis
      let completion;
      let modelUsed = "gpt-4";
      
      try {
        // Try with GPT-4 first
        completion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Please analyze the following transcript:\n\n${textToAnalyze}` }
          ],
          temperature: 0.3,
          max_tokens: 1000
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
              { role: "user", content: `Please analyze the following transcript:\n\n${textToAnalyze}` }
            ],
            temperature: 0.3,
            max_tokens: 1000
          }, { signal: controller.signal });
        } else {
          // Re-throw other errors
          throw error;
        }
      }
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      // Process the response
      const responseContent = completion.choices[0]?.message?.content || '';
      console.log(`Raw response from OpenAI (${modelUsed}):`, responseContent.substring(0, 200) + '...');
      let analysisData;

      try {
        // First attempt: Direct JSON parsing
        analysisData = JSON.parse(responseContent || '{}');
        console.log('Successfully parsed analysis data');
      } catch (e) {
        console.error('Error parsing OpenAI response as JSON:', e);
        
        // Second attempt: Extract JSON from non-JSON response
        try {
          const jsonMatch = responseContent?.match(/\{[\s\S]*\}/);
          if (jsonMatch && jsonMatch[0]) {
            analysisData = JSON.parse(jsonMatch[0]);
            console.log('Successfully extracted and parsed JSON from response');
          } else {
            // Third attempt: Check if this is an error or apology response
            if (responseContent?.includes("I'm sorry") || 
                responseContent?.includes("can't provide") || 
                responseContent?.includes("no transcript")) {
              
              console.log('Detected OpenAI error/apology response, creating fallback structure');
              analysisData = {
                sentiment: 'neutral',
                sentiment_explanation: 'Analysis could not be completed',
                pain_points: [],
                feature_requests: [],
                topics: [],
                key_insights: [],
                error: responseContent?.substring(0, 500) || 'Failed to analyze transcript'
              };
            } else {
              throw new Error('Could not extract JSON from response');
            }
          }
        } catch (extractError) {
          console.error('Failed to extract JSON from response:', extractError);
          
          // Final fallback: Create a minimal valid structure
          analysisData = {
            sentiment: 'neutral',
            sentiment_explanation: 'Analysis could not be completed due to parsing error',
            pain_points: [],
            feature_requests: [],
            topics: [],
            key_insights: [],
            error: 'Failed to parse analysis results'
          };
        }
      }

      // Ensure the analysis data has the required structure
      analysisData = {
        sentiment: analysisData.sentiment || 'neutral',
        sentiment_explanation: analysisData.sentiment_explanation || 'No explanation provided',
        pain_points: Array.isArray(analysisData.pain_points) ? analysisData.pain_points : [],
        feature_requests: Array.isArray(analysisData.feature_requests) ? analysisData.feature_requests : [],
        topics: Array.isArray(analysisData.topics) ? analysisData.topics : [],
        key_insights: Array.isArray(analysisData.key_insights) ? analysisData.key_insights : []
      };

      // Update transcription record with analysis data - use field names from the database
      console.log('Updating transcription record with analysis data...');
      const { error: updateError } = await supabaseAdmin
        .from('transcriptions')
        .update({
          analysis_data: analysisData,
          analysis_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', transcriptionId);

      if (updateError) {
        console.error('Error updating transcription with analysis:', updateError);
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to save analysis results',
          details: updateError.message 
        }, { status: 500 });
      }

      // Double-check that the record was updated correctly
      const { data: updatedRecord, error: checkError } = await supabase
        .from('transcriptions')
        .select('id, analysis_status, analysis_data')
        .eq('id', transcriptionId)
        .single();
        
      if (checkError) {
        console.error('Error verifying update:', checkError);
      } else {
        console.log('Verified update. Analysis status:', updatedRecord.analysis_status);
        console.log('Analysis data present:', !!updatedRecord.analysis_data);
      }

      console.log('Analysis completed and saved successfully');
      return NextResponse.json({ 
        success: true,
        analysis: analysisData
      });

    } catch (error: any) {
      console.error('Unexpected error in analysis API:', error);
      return NextResponse.json({ 
        error: 'Analysis failed',
        message: error.message || 'An unexpected error occurred',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Unexpected error in analysis API:', error);
    return NextResponse.json({ 
      error: 'Analysis failed',
      message: error.message || 'An unexpected error occurred',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

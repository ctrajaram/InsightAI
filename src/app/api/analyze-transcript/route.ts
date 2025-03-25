import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Initialize OpenAI client
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

// Define the structure for transcription record
interface TranscriptionRecord {
  id: string;
  user_id: string;
  transcription_text: string;
  analysis_status?: string;
  analysis_data?: any;
  [key: string]: any; // For other potential fields
}

// Define structure for analysis data
interface AnalysisData {
  sentiment: string;
  sentiment_explanation: string;
  pain_points: Array<{
    issue: string;
    description: string;
    quotes: string[];
  }>;
  feature_requests: Array<{
    feature: string;
    description: string;
    quotes: string[];
  }>;
  [key: string]: any; // For flexibility
}

// Helper function to process OpenAI response with better error handling
const processOpenAIResponse = (content: string): AnalysisData => {
  // First try direct JSON parsing
  try {
    const jsonData = JSON.parse(content);
    return jsonData as AnalysisData;
  } catch (parseError) {
    console.error('Direct JSON parsing failed:', parseError);
    
    // Try to extract JSON from text (in case of extra text around valid JSON)
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch && jsonMatch[0]) {
        const extractedJson = jsonMatch[0];
        console.log('Extracted potential JSON:', extractedJson.substring(0, 100) + '...');
        return JSON.parse(extractedJson) as AnalysisData;
      }
    } catch (extractError) {
      console.error('JSON extraction failed:', extractError);
    }
    
    // If all else fails, create a fallback object
    return {
      sentiment: "unknown",
      sentiment_explanation: "Failed to parse AI response",
      pain_points: [],
      feature_requests: []
    };
  }
};

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Parse request body with error handling
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('Failed to parse request body as JSON:', parseError);
      return NextResponse.json({ 
        error: 'Invalid JSON in request body',
        details: 'Please ensure the request body is valid JSON'
      }, { status: 400 });
    }
    
    const { transcriptionId, transcriptionText, accessToken } = body;

    console.log('API Request received for transcriptionId:', transcriptionId);
    console.log('Request body type:', typeof body);
    console.log('Transcription text provided?', !!transcriptionText);
    console.log('Transcription text length:', transcriptionText?.length || 0);
    console.log('Access token provided?', !!accessToken);

    // Check for authentication
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json(
        { error: 'Authentication required. Please sign in and try again.' }, 
        { status: 401 }
      );
    }

    // Check for required fields
    if (!transcriptionId && !transcriptionText) {
      console.error('Missing required fields: transcriptionId or transcriptionText');
      return NextResponse.json({ error: 'Missing required fields: transcriptionId or transcriptionText' }, { status: 400 });
    }

    let finalTranscriptionText = transcriptionText;
    let transcriptionRecord: TranscriptionRecord | null = null;

    // If transcriptionId is provided, try to fetch the record from the database
    if (transcriptionId) {
      if (typeof transcriptionId !== 'string' || transcriptionId.trim() === '') {
        console.error('Invalid transcription ID received:', transcriptionId);
        return NextResponse.json({ error: 'Valid transcription ID is required' }, { status: 400 });
      }

      // Sanitize the ID
      const cleanTranscriptionId = transcriptionId.trim();
      console.log('Cleaned transcription ID:', cleanTranscriptionId);
      console.log('Transcription ID length:', cleanTranscriptionId.length);
      
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(cleanTranscriptionId)) {
        console.error('Invalid UUID format:', cleanTranscriptionId);
        return NextResponse.json({ error: 'Invalid UUID format for transcription ID' }, { status: 400 });
      }

      // Check if OpenAI API key is configured
      if (!process.env.OPENAI_API_KEY) {
        console.error('OpenAI API key is not configured');
        return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 500 });
      }

      // Create Supabase client
      console.log('Creating Supabase client...');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      console.log('Supabase client created successfully');

      // Try to get the specific transcription with retry mechanism
      try {
        transcriptionRecord = await retryOperation(async () => {
          console.log('Querying for transcription with ID:', cleanTranscriptionId);
          const { data, error } = await supabase
            .from('transcriptions')
            .select('*')
            .eq('id', cleanTranscriptionId)
            .single();
            
          if (error) {
            console.error('Error fetching transcription:', error);
            throw error;
          }
          
          if (!data) {
            throw new Error('No transcription found with ID: ' + cleanTranscriptionId);
          }
          
          return data as TranscriptionRecord;
        }, 3, 1000);
        
        if (transcriptionRecord) {
          console.log('Found transcription record:', transcriptionRecord);
          
          // Use the transcription text from the database if not provided directly
          if (!finalTranscriptionText) {
            finalTranscriptionText = transcriptionRecord.transcription_text;
          }
          
          // Update analysis status to processing - using the field names from the database
          console.log('Updating analysis status to processing...');
          await retryOperation(async () => {
            const { error: updateStatusError } = await supabase
              .from('transcriptions')
              .update({
                analysis_status: 'processing',
                updated_at: new Date().toISOString()
              })
              .eq('id', transcriptionRecord!.id);

            if (updateStatusError) {
              console.error('Error updating analysis status:', updateStatusError);
              throw updateStatusError;
            }
          });
        }
      } catch (recordError: any) {
        console.error('Error retrieving transcription record:', recordError);
        
        // If we have transcriptionText provided directly, we can still proceed
        if (!finalTranscriptionText) {
          return NextResponse.json({ 
            error: 'Transcription not found and no transcription text provided',
            details: recordError.message || 'No matching record found with ID: ' + cleanTranscriptionId
          }, { status: 404 });
        }
        
        console.log('Proceeding with provided transcription text despite database error');
      }
    }

    // Final check for transcription text
    if (!finalTranscriptionText) {
      console.error('No transcription text available from any source');
      return NextResponse.json({ error: 'Transcription text is empty or not provided' }, { status: 400 });
    }

    // Prepare prompt for GPT-4
    console.log('Preparing prompt for OpenAI...');
    const prompt = `
You are an expert at analyzing customer interviews and extracting valuable insights. 
Analyze the following interview transcript and extract:

1. Overall customer sentiment (positive, neutral, or negative)
2. A brief explanation of why you determined this sentiment (2-3 sentences)
3. Top customer pain points (3-5 points)
4. Top requested features or improvements (3-5 ideas)

For pain points and feature requests, include:
- A clear title/summary of the issue or request
- A brief description explaining it
- 1-2 direct quotes from the transcript that support this point

Format your response as a valid JSON object with the following structure:
{
  "sentiment": "positive|neutral|negative",
  "sentiment_explanation": "Brief explanation of sentiment",
  "pain_points": [
    {
      "issue": "Issue title",
      "description": "Brief description",
      "quotes": ["Quote 1", "Quote 2"]
    }
  ],
  "feature_requests": [
    {
      "feature": "Feature title",
      "description": "Brief description",
      "quotes": ["Quote 1", "Quote 2"]
    }
  ]
}

Transcript:
${finalTranscriptionText}
`;

    // Call OpenAI API with timeout handling
    console.log('Calling OpenAI API...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are an expert at analyzing customer interviews and extracting insights.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }, { signal: controller.signal });
      
      clearTimeout(timeoutId); // Clear the timeout if the request completes successfully
      
      // Parse the response
      console.log('Received response from OpenAI, parsing...');
      const analysisText = response.choices[0].message.content || '';
      
      // Use the helper function to process the response
      const analysisData = processOpenAIResponse(analysisText);
      
      // Validate the structure of the analysis data
      if (!analysisData.sentiment) {
        console.warn('Warning: sentiment field is missing from the analysis data');
        analysisData.sentiment = "unknown";
      }
      
      if (!analysisData.sentiment_explanation) {
        console.warn('Warning: sentiment_explanation field is missing from the analysis data');
        // Add a default explanation if missing
        analysisData.sentiment_explanation = "No sentiment explanation provided by the AI.";
      } else {
        console.log('Sentiment explanation found:', analysisData.sentiment_explanation);
      }
      
      if (!analysisData.pain_points || !Array.isArray(analysisData.pain_points)) {
        console.warn('Warning: pain_points field is missing or not an array');
        analysisData.pain_points = [];
      }
      
      if (!analysisData.feature_requests || !Array.isArray(analysisData.feature_requests)) {
        console.warn('Warning: feature_requests field is missing or not an array');
        analysisData.feature_requests = [];
      }
      
      // Update the record with the analysis results if we have a transcription record
      if (transcriptionRecord && transcriptionId) {
        console.log('Updating record with analysis results...');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        
        // Use retry mechanism for the update operation
        await retryOperation(async () => {
          const { error: updateError } = await supabase
            .from('transcriptions')
            .update({
              analysis_status: 'completed',
              analysis_data: analysisData,
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);

          if (updateError) {
            console.error('Error updating record with analysis:', updateError);
            throw updateError;
          }
          
          console.log('Analysis completed and saved successfully');
        });
      } else {
        console.log('No transcription record to update, returning analysis data only');
      }
      
      // Return the analysis data
      return NextResponse.json({
        success: true,
        analysis: analysisData
      });
    } catch (error: any) {
      clearTimeout(timeoutId); // Make sure to clear the timeout
      
      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        console.error('OpenAI API request timed out after 2 minutes');
        return NextResponse.json({ 
          error: 'The analysis process timed out',
          details: 'The request to the AI service took too long to complete. Please try again with a shorter transcript.'
        }, { status: 504 }); // Gateway Timeout
      }
      
      throw error; // Re-throw for the outer catch block
    }
  } catch (error: any) {
    console.error('Unexpected error in analyze API:', error);
    return NextResponse.json({ 
      error: 'An unexpected error occurred',
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}

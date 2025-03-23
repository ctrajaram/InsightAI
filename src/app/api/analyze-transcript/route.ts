import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    // Parse request body
    const body = await req.json();
    const { transcriptionId, transcriptionText, accessToken } = body;

    console.log('API Request received for transcriptionId:', transcriptionId);
    console.log('Request body:', body);
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
    let transcriptionRecord = null;

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

      // Try to get the specific transcription
      console.log('Querying for transcription with ID:', cleanTranscriptionId);
      const { data: transcription, error: directError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', cleanTranscriptionId)
        .single();
        
      if (directError) {
        console.error('Error fetching transcription:', directError);
        console.error('Error code:', directError.code);
        console.error('Error message:', directError.message);
        console.error('Error details:', directError.details);
        
        // If we have transcriptionText provided directly, we can still proceed
        if (!finalTranscriptionText) {
          return NextResponse.json({ 
            error: 'Transcription not found and no transcription text provided',
            details: directError.message || 'No matching record found with ID: ' + cleanTranscriptionId
          }, { status: 404 });
        }
        
        console.log('Proceeding with provided transcription text despite database error');
      } else if (!transcription) {
        console.error('No transcription found with ID:', cleanTranscriptionId);
        
        // If we have transcriptionText provided directly, we can still proceed
        if (!finalTranscriptionText) {
          return NextResponse.json({ 
            error: 'Transcription not found and no transcription text provided',
            details: 'No matching record found with ID: ' + cleanTranscriptionId
          }, { status: 404 });
        }
        
        console.log('Proceeding with provided transcription text despite no record found');
      } else {
        console.log('Found transcription record:', transcription);
        transcriptionRecord = transcription;
        
        // Use the transcription text from the database if not provided directly
        if (!finalTranscriptionText) {
          finalTranscriptionText = transcription.transcription_text;
        }
        
        // Update analysis status to processing - using the field names from the database
        console.log('Updating analysis status to processing...');
        const { error: updateStatusError } = await supabase
          .from('transcriptions')
          .update({
            analysis_status: 'processing',
            updated_at: new Date().toISOString()
          })
          .eq('id', transcription.id);

        if (updateStatusError) {
          console.error('Error updating analysis status:', updateStatusError);
        }
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

    // Call OpenAI API
    console.log('Calling OpenAI API...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are an expert at analyzing customer interviews and extracting insights.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    // Parse the response
    console.log('Received response from OpenAI, parsing...');
    const analysisText = response.choices[0].message.content || '';
    let analysisData;

    try {
      analysisData = JSON.parse(analysisText);
      console.log('Successfully parsed analysis data:', analysisData);
      
      // Validate the structure of the analysis data
      if (!analysisData.sentiment_explanation) {
        console.warn('Warning: sentiment_explanation field is missing from the analysis data');
        // Add a default explanation if missing
        analysisData.sentiment_explanation = "No sentiment explanation provided by the AI.";
      } else {
        console.log('Sentiment explanation found:', analysisData.sentiment_explanation);
      }
    } catch (parseError) {
      console.error('Error parsing OpenAI response as JSON:', parseError);
      console.log('Raw response:', analysisText);
      
      return NextResponse.json({ 
        error: 'Failed to parse analysis response',
        details: 'The AI response could not be parsed as valid JSON'
      }, { status: 500 });
    }

    // Update the record with the analysis results if we have a transcription record
    if (transcriptionRecord && transcriptionId) {
      console.log('Updating record with analysis results...');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      
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
        // Continue anyway to return the analysis data
      } else {
        console.log('Analysis completed and saved successfully');
      }
    } else {
      console.log('No transcription record to update, returning analysis data only');
    }
    
    // Return the analysis data
    return NextResponse.json({
      success: true,
      analysis: analysisData
    });
    
  } catch (error: any) {
    console.error('Unexpected error in analyze API:', error);
    return NextResponse.json({ 
      error: 'An unexpected error occurred',
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}

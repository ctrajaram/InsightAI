import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set a longer timeout for this route (10 minutes)
export const maxDuration = 600; // 10 minutes in seconds

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
  try {
    // Parse request body
    const body = await req.json();
    const { transcriptionId, transcriptionText } = body;

    console.log('API Request received for transcriptionId:', transcriptionId);
    console.log('Transcription text length:', transcriptionText?.length || 'Not provided');

    if (!transcriptionId || typeof transcriptionId !== 'string' || transcriptionId.trim() === '') {
      return NextResponse.json({ error: 'Valid transcription ID is required' }, { status: 400 });
    }

    // Sanitize the ID
    const cleanTranscriptionId = transcriptionId.trim();
    console.log('Cleaned transcription ID:', cleanTranscriptionId);

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

    // If transcription text is provided directly, use it
    let finalTranscriptionText = '';
    
    if (transcriptionText && typeof transcriptionText === 'string') {
      console.log('Using provided transcription text');
      finalTranscriptionText = transcriptionText;
    } else {
      // Otherwise, fetch from database
      console.log('Querying for transcription with ID:', cleanTranscriptionId);
      const { data: transcription, error: directError } = await supabase
        .from('transcriptions')
        .select('*')
        .eq('id', cleanTranscriptionId)
        .single();
        
      if (directError) {
        console.error('Error fetching transcription:', directError);
        return NextResponse.json({ 
          error: 'Transcription not found',
          details: directError.message || 'No matching record found with ID: ' + cleanTranscriptionId
        }, { status: 404 });
      }

      if (!transcription) {
        console.error('No transcription found with ID:', cleanTranscriptionId);
        return NextResponse.json({ 
          error: 'Transcription not found',
          details: 'No matching record found with ID: ' + cleanTranscriptionId
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

    // Update analysis status to processing - using the field names from the database
    console.log('Updating analysis status to processing...');
    const { error: updateStatusError } = await supabase
      .from('transcriptions')
      .update({
        analysis_status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', cleanTranscriptionId);

    if (updateStatusError) {
      console.error('Error updating analysis status:', updateStatusError);
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

Note: This transcript may have been truncated due to its length. Focus on the available content to provide the best analysis possible.

Transcript:
${textToAnalyze}
`;

    // Call OpenAI API with optimized parameters
    console.log('Calling OpenAI API with optimized parameters...');
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-16k', // Use a faster model with larger context window
      messages: [
        { role: 'system', content: 'You are an expert at analyzing customer interviews and extracting insights.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1500, // Reduced to ensure faster response
    });

    // Parse the response
    console.log('Received response from OpenAI, parsing...');
    const analysisText = response.choices[0].message.content;
    let analysisData;

    try {
      analysisData = JSON.parse(analysisText || '{}');
      console.log('Successfully parsed analysis data');
    } catch (e) {
      console.error('Error parsing OpenAI response as JSON:', e);
      
      // Attempt to extract JSON from non-JSON response
      try {
        const jsonMatch = analysisText?.match(/\{[\s\S]*\}/);
        if (jsonMatch && jsonMatch[0]) {
          analysisData = JSON.parse(jsonMatch[0]);
          console.log('Successfully extracted and parsed JSON from response');
        } else {
          throw new Error('Could not extract JSON from response');
        }
      } catch (extractError) {
        console.error('Failed to extract JSON from response:', extractError);
        return NextResponse.json({ error: 'Failed to parse analysis results' }, { status: 500 });
      }
    }

    // Update transcription record with analysis data - use field names from the database
    console.log('Updating transcription record with analysis data...');
    const { error: updateError } = await supabase
      .from('transcriptions')
      .update({
        analysis_data: analysisData,
        analysis_status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', cleanTranscriptionId);

    if (updateError) {
      console.error('Error updating transcription with analysis:', updateError);
      return NextResponse.json({ error: 'Failed to save analysis results' }, { status: 500 });
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
}

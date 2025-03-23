import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    // Parse request body
    const body = await req.json();
    const { transcriptionId } = body;

    console.log('API Request received for transcriptionId:', transcriptionId);

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

    // First, check if the table exists and what fields it has
    console.log('Checking transcriptions table structure...');
    const { data: tableInfo, error: tableError } = await supabase
      .from('transcriptions')
      .select('*')
      .limit(1);
      
    if (tableError) {
      console.error('Error checking table structure:', tableError);
      console.error('Error code:', tableError.code);
      console.error('Error message:', tableError.message);
      console.error('Error details:', tableError.details);
    } else {
      console.log('Table structure sample:', tableInfo);
      console.log('Table fields:', tableInfo && tableInfo.length > 0 ? Object.keys(tableInfo[0]) : 'No records found');
    }

    // Try to get the transcription directly
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
      
      // Try to get all transcriptions to see what's available
      console.log('Attempting to list all transcriptions...');
      const { data: allTranscriptions, error: listError } = await supabase
        .from('transcriptions')
        .select('id, created_at, status')
        .order('created_at', { ascending: false });
        
      if (listError) {
        console.error('Error listing transcriptions:', listError);
      } else {
        console.log('Recent transcriptions:', allTranscriptions);
      }
      
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
    const transcriptionText = transcription.transcription_text;
    if (!transcriptionText) {
      console.error('Transcription text is empty in record:', transcription);
      return NextResponse.json({ error: 'Transcription text is empty' }, { status: 400 });
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
${transcriptionText}
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
    const analysisText = response.choices[0].message.content;
    let analysisData;

    try {
      analysisData = JSON.parse(analysisText || '{}');
      console.log('Successfully parsed analysis data');
    } catch (e) {
      console.error('Error parsing OpenAI response as JSON:', e);
      return NextResponse.json({ error: 'Failed to parse analysis results' }, { status: 500 });
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
      .eq('id', transcription.id);

    if (updateError) {
      console.error('Error updating transcription with analysis:', updateError);
      return NextResponse.json({ error: 'Failed to save analysis results' }, { status: 500 });
    }

    // Verify the update was successful
    console.log('Verifying analysis data was saved...');
    const { data: verifiedData, error: verifyError } = await supabase
      .from('transcriptions')
      .select('id, analysis_status, analysis_data')
      .eq('id', transcription.id)
      .single();
      
    if (verifyError) {
      console.error('Error verifying analysis data:', verifyError);
    } else {
      console.log('Verified analysis data:', verifiedData);
    }

    console.log('Analysis completed successfully');
    return NextResponse.json({ 
      success: true, 
      analysis: analysisData 
    });

  } catch (error: any) {
    console.error('Error analyzing transcript:', error);
    return NextResponse.json({ 
      error: `Failed to analyze transcript: ${error.message}` 
    }, { status: 500 });
  }
}

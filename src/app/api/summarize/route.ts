import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Create a standard Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const { transcriptionId, transcriptionText, accessToken } = await request.json();
    
    // Basic validation
    if (!transcriptionId || !transcriptionText) {
      console.error('Missing required fields for summarization');
      return NextResponse.json(
        { error: 'Missing required fields: transcriptionId or transcriptionText' }, 
        { status: 400 }
      );
    }
    
    if (transcriptionText.trim().length < 10) {
      console.error('Transcription text too short for summarization');
      return NextResponse.json(
        { error: 'Transcription text too short for summarization' }, 
        { status: 400 }
      );
    }
    
    // Check for authentication token
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json(
        { error: 'Authentication required. Please sign in and try again.' }, 
        { status: 401 }
      );
    }
    
    // Verify the token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { error: 'Authentication failed. Please sign in again.' }, 
        { status: 401 }
      );
    }
    
    console.log(`Processing summary for user: ${user.email} (ID: ${user.id}), transcription: ${transcriptionId}`);
    
    // Check if OpenAI API key is set
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey || openaiApiKey === 'your-openai-api-key') {
      console.error('OpenAI API key not configured correctly');
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set up your API key.' }, 
        { status: 500 }
      );
    }
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    
    // Update transcription record to show summarizing status
    const { error: updateError } = await supabase
      .from('transcriptions')
      .update({ summary_status: 'processing' })
      .eq('id', transcriptionId);
    
    if (updateError) {
      console.error('Error updating summary status:', updateError);
      return NextResponse.json(
        { error: 'Failed to update summary status' }, 
        { status: 500 }
      );
    }
    
    // Craft the prompt for GPT-4
    const prompt = `
    Create a concise summary of the following transcript. 
    Highlight key points, main topics discussed, and any actionable items or conclusions.
    Focus on delivering the most important information in a clear, organized manner.
    
    TRANSCRIPT:
    ${transcriptionText}
    
    SUMMARY:
    `;
    
    // Generate summary with GPT-4
    console.log('Sending to GPT-4 for summarization...');
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a skilled assistant that creates concise, accurate summaries of transcribed content." },
        { role: "user", content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 500,
    });
    
    // Extract the generated summary
    const summaryText = completion.choices[0].message.content?.trim();
    console.log('Summary generated, length:', summaryText?.length);
    
    if (!summaryText) {
      throw new Error('Failed to generate summary: Empty response from OpenAI');
    }
    
    // Update the database with the summary
    const { error: saveError } = await supabase
      .from('transcriptions')
      .update({
        summary_text: summaryText,
        summary_status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId);
    
    if (saveError) {
      console.error('Error saving summary to database:', saveError);
      return NextResponse.json(
        { error: 'Failed to save summary to database' }, 
        { status: 500 }
      );
    }
    
    console.log('Summary saved to database successfully');
    
    // Return the summary
    return NextResponse.json({
      success: true,
      transcriptionId,
      summary: {
        text: summaryText,
        status: 'completed'
      }
    });
    
  } catch (error: any) {
    console.error('Summarization API error:', error);
    
    // Try to update the transcription record with error status
    try {
      if (request.body) {
        const { transcriptionId } = await request.json();
        if (transcriptionId) {
          await supabase
            .from('transcriptions')
            .update({
              summary_status: 'error',
              error: error.message || 'Error generating summary',
              updated_at: new Date().toISOString()
            })
            .eq('id', transcriptionId);
        }
      }
    } catch (updateError) {
      console.error('Error updating summary error status:', updateError);
    }
    
    return NextResponse.json(
      { error: error.message || 'An error occurred during summarization' },
      { status: 500 }
    );
  }
}

// Configure response options
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Use your preferred Vercel region
}; 
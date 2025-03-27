import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Force no caching to prevent stale responses
export const fetchCache = 'force-no-store';

export async function PUT(request: Request) {
  try {
    // Initialize Supabase client with environment variables
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Parse the request body
    const body = await request.json();
    const { transcriptionId, summaryData, accessToken } = body;

    console.log('Update Summary API: Request received for transcription ID:', transcriptionId);
    
    // Validate required fields
    if (!transcriptionId) {
      return NextResponse.json({ 
        success: false,
        error: 'Missing transcription ID' 
      }, { status: 400 });
    }

    if (!summaryData) {
      return NextResponse.json({ 
        success: false,
        error: 'Missing summary data' 
      }, { status: 400 });
    }

    // Get the final token for authentication
    const authHeader = request.headers.get('Authorization');
    const finalAccessToken = accessToken || (authHeader ? authHeader.replace('Bearer ', '') : null);

    if (!finalAccessToken) {
      console.error('Update Summary API: No access token provided');
      return NextResponse.json({ 
        success: false,
        error: 'Authorization required',
        details: 'Please provide a valid access token'
      }, { status: 401 });
    }

    // Verify the user's authentication
    const { data: userData, error: authError } = await supabase.auth.getUser(finalAccessToken);
    if (authError || !userData.user) {
      console.error('Update Summary API: Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { 
          success: false,
          error: 'Authentication failed. Please sign in again or refresh the page to get a new session token.',
          details: authError?.message || 'Session token invalid or expired'
        }, 
        { status: 401 }
      );
    }

    console.log('Update Summary API: User authenticated:', userData.user.id);

    // Update the transcription with the summary data
    const { data: updatedTranscription, error: updateError } = await supabase
      .from('transcriptions')
      .update({
        summary_text: summaryData.text,
        summary_key_points: summaryData.keyPoints || [],
        summary_topics: summaryData.topics || [],
        summary_status: 'completed'
      })
      .eq('id', transcriptionId)
      .select()
      .single();

    if (updateError) {
      console.error('Update Summary API: Error updating transcription:', updateError.message);
      return NextResponse.json(
        { 
          success: false,
          error: 'Failed to update summary data',
          details: updateError.message
        },
        { status: 500 }
      );
    }

    console.log('Update Summary API: Successfully updated transcription:', updatedTranscription.id);

    // Return the updated transcription
    return NextResponse.json({
      success: true,
      transcription: updatedTranscription
    });
  } catch (error: any) {
    console.error('Update Summary API: Unexpected error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'An unexpected error occurred',
        details: error.message || String(error)
      },
      { status: 500 }
    );
  }
}

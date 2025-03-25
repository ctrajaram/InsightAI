import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
  try {
    // Initialize Supabase client with environment variables
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Parse the request body
    const body = await request.json();
    const { transcriptionId, accessToken, analysisData } = body;

    console.log('Update Analysis API: Request received for transcription ID:', transcriptionId);
    
    // Validate required fields
    if (!transcriptionId) {
      return NextResponse.json({ error: 'Missing transcription ID' }, { status: 400 });
    }

    if (!analysisData) {
      return NextResponse.json({ error: 'Missing analysis data' }, { status: 400 });
    }

    // Get the final token for authentication
    const finalAccessToken = accessToken || request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!finalAccessToken) {
      console.error('Update Analysis API: No access token provided');
      return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
    }

    // Verify the user's authentication
    const { data: userData, error: authError } = await supabase.auth.getUser(finalAccessToken);
    if (authError || !userData.user) {
      console.error('Update Analysis API: Authentication error:', authError?.message);
      return NextResponse.json(
        { error: 'Authentication failed. Please log in again.' },
        { status: 401 }
      );
    }

    console.log('Update Analysis API: User authenticated:', userData.user.id);

    // Update the transcription with the analysis data
    const { data: updatedTranscription, error: updateError } = await supabase
      .from('transcriptions')
      .update({
        analysis_data: analysisData,
        analysis_status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptionId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Update Analysis API: Error updating transcription:', updateError.message);
      return NextResponse.json(
        { error: 'Failed to update analysis data' },
        { status: 500 }
      );
    }

    console.log('Update Analysis API: Successfully updated analysis data for transcription ID:', transcriptionId);
    
    return NextResponse.json({
      success: true,
      transcription: updatedTranscription
    });
  } catch (error) {
    console.error('Update Analysis API: Unexpected error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

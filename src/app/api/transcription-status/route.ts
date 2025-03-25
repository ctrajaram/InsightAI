export const fetchCache = "force-no-store";

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Create a standard Supabase client without relying on cookies
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Get the transcription ID from the URL
    const searchParams = request.nextUrl.searchParams;
    const transcriptionId = searchParams.get('id');
    const accessToken = searchParams.get('token');
    
    // Basic validation
    if (!transcriptionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: id' }, 
        { status: 400 }
      );
    }
    
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' }, 
        { status: 401 }
      );
    }
    
    // Verify the token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { success: false, error: 'Authentication failed. Please sign in again.' }, 
        { status: 401 }
      );
    }
    
    // Get the transcription record
    const { data: transcription, error } = await supabase
      .from('transcriptions')
      .select('*')
      .eq('id', transcriptionId)
      .eq('user_id', user.id)
      .single();
    
    if (error) {
      console.error('Error fetching transcription:', error.message);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transcription status' }, 
        { status: 500 }
      );
    }
    
    if (!transcription) {
      return NextResponse.json(
        { success: false, error: 'Transcription not found' }, 
        { status: 404 }
      );
    }
    
    // Return the status
    return NextResponse.json({
      success: true,
      status: transcription.status,
      progress: transcription.progress || 0,
      transcriptionText: transcription.transcription_text || '',
      error: transcription.error || null,
      updatedAt: transcription.updated_at
    });
  } catch (error: any) {
    console.error('Unexpected error in transcription status API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'An unexpected error occurred', 
        details: error.message 
      }, 
      { status: 500 }
    );
  }
}

// Add a global error handler to catch any unexpected errors and format them as JSON
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    externalResolver: true,
  },
};

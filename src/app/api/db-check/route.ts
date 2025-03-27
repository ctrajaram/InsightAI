import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Initialize environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Declare Supabase client variable but don't initialize it yet
let supabase: ReturnType<typeof createClient> | null = null;

// Only initialize if we have the necessary environment variables
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined' && supabaseUrl && supabaseAnonKey) {
  try {
    // Create Supabase client without relying on cookies
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('DB Check API: Supabase client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabase = null;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if Supabase client is initialized
    if (!supabase) {
      return NextResponse.json({
        status: 'error',
        message: 'Supabase client not initialized'
      }, { status: 500 });
    }
    
    // Check table structure
    const { data: tableInfo, error: tableError } = await supabase
      .from('transcriptions')
      .select('*')
      .limit(1);
    
    if (tableError) {
      console.error('Error checking table structure:', tableError);
      return NextResponse.json({
        status: 'error',
        message: 'Error checking table structure',
        error: tableError
      }, { status: 500 });
    }
    
    // Check buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Error listing buckets:', bucketsError);
      return NextResponse.json({
        status: 'error',
        message: 'Error listing storage buckets',
        error: bucketsError
      }, { status: 500 });
    }
    
    // Attempt to create a test record with proper UUID
    const testId = uuidv4();
    const { data: insertData, error: insertError } = await supabase
      .from('transcriptions')
      .insert({
        id: testId,
        user_id: 'test-user',
        media_path: 'test-path',
        media_url: 'test-url',
        file_name: 'test-file.mp3',
        file_size: 1024,
        content_type: 'audio/mp3',
        status: 'testing',
        created_at: new Date().toISOString(),
        transcription_text: ''
      })
      .select();
    
    let insertResult = 'Not attempted';
    if (insertError) {
      insertResult = `Failed: ${insertError.message}`;
    } else {
      insertResult = `Success: Created record with ID ${insertData?.[0]?.id}`;
      
      // Clean up test record
      await supabase
        .from('transcriptions')
        .delete()
        .eq('id', testId);
    }
    
    return NextResponse.json({
      status: 'success',
      table_structure: tableInfo ? 'Table exists' : 'No data found',
      table_columns: tableInfo && tableInfo.length > 0 ? Object.keys(tableInfo[0]) : [],
      buckets: buckets?.map(b => b.name) || [],
      insert_test: insertResult
    });
  } catch (error: any) {
    console.error('Database check error:', error);
    return NextResponse.json({
      status: 'error',
      message: error.message || 'Unknown error',
      error
    }, { status: 500 });
  }
}
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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
    console.log('Create Bucket API: Supabase client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabase = null;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if the bucket already exists
    if (!supabase) {
      return NextResponse.json({
        status: 'error',
        message: 'Supabase client not initialized'
      }, { status: 500 });
    }
    
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
      console.error('Error listing buckets:', bucketError);
      return NextResponse.json({
        status: 'error',
        message: 'Failed to list buckets',
        error: bucketError
      }, { status: 500 });
    }
    
    // Check if media-files bucket exists
    const mediaFilesBucket = buckets?.find(b => b.name === 'media-files');
    
    if (mediaFilesBucket) {
      return NextResponse.json({
        status: 'success',
        message: 'media-files bucket already exists',
        buckets: buckets?.map(b => b.name) || []
      });
    }
    
    // Create the media-files bucket
    const { data, error } = await supabase.storage.createBucket('media-files', {
      public: true,
      fileSizeLimit: 26214400, // 25MB in bytes
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3']
    });
    
    if (error) {
      console.error('Error creating bucket:', error);
      return NextResponse.json({
        status: 'error',
        message: 'Failed to create bucket',
        error
      }, { status: 500 });
    }
    
    // List buckets again to verify
    const { data: updatedBuckets } = await supabase.storage.listBuckets();
    
    return NextResponse.json({
      status: 'success',
      message: 'Successfully created media-files bucket',
      buckets: updatedBuckets?.map(b => b.name) || []
    });
  } catch (error: any) {
    console.error('Create bucket error:', error);
    return NextResponse.json({
      status: 'error',
      message: error.message || 'Unknown error',
      error
    }, { status: 500 });
  }
} 
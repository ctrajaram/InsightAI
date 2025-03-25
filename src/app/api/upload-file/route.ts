import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { v4 as uuidv4 } from 'uuid';

// Define bucket name for media files
const MEDIA_BUCKET = 'media-files';

// Maximum file size (25MB)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Get the current user session
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const userId = session.user.id;
    
    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `File size exceeds the maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      }, { status: 400 });
    }
    
    // Generate a unique filename
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9\._-]/g, '_');
    const uniqueFileName = `${timestamp}-${safeFileName}`;
    
    // Store in user's folder for proper permissions
    const storagePath = `${userId}/${uniqueFileName}`;
    
    console.log(`Server uploading file to ${MEDIA_BUCKET}/${storagePath}`);
    
    // Upload the file to Supabase Storage
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });
    
    if (error) {
      console.error('Server error uploading file:', error);
      
      // Check for specific error types
      if (error.message.includes('bucket') && error.message.includes('not found')) {
        return NextResponse.json({ 
          error: `Storage bucket '${MEDIA_BUCKET}' not found`,
          bucketError: true
        }, { status: 500 });
      }
      
      if (error.message.includes('row-level security policy')) {
        return NextResponse.json({ 
          error: 'Permission denied due to storage security policies',
          rlsError: true
        }, { status: 403 });
      }
      
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Get the public URL for the file
    const { data: { publicUrl } } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(storagePath);
    
    console.log('Server successfully uploaded file with URL:', publicUrl);
    
    // Return the file information
    return NextResponse.json({
      path: storagePath,
      url: publicUrl,
      filename: file.name,
      contentType: file.type,
      size: file.size
    });
    
  } catch (error: any) {
    console.error('Unexpected error in upload-file API route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Configure the API route to accept larger payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '26mb' // Slightly larger than our max file size to account for overhead
    }
  }
};

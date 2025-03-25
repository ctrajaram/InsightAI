import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

// Define bucket name for media files
const MEDIA_BUCKET = 'media-files';

export async function POST(request: NextRequest) {
  try {
    // Get the current user session
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const userId = session.user.id;
    
    // Parse the request body
    const { filename, contentType, size } = await request.json();
    
    if (!filename || !contentType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Generate a unique filename
    const timestamp = Date.now();
    const safeFileName = filename.replace(/[^a-zA-Z0-9\._-]/g, '_');
    const uniqueFileName = `${timestamp}-${safeFileName}`;
    
    // Store in user's folder for proper permissions
    const storagePath = `${userId}/${uniqueFileName}`;
    
    console.log(`Generating signed URL for ${MEDIA_BUCKET}/${storagePath}`);
    
    try {
      // Generate a signed URL for direct upload
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUploadUrl(storagePath);
      
      if (error) {
        console.error('Error generating signed URL:', error);
        
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
      
      // Get the public URL for the file (for after upload is complete)
      const { data: { publicUrl } } = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(storagePath);
      
      // Return the signed URL and file information
      return NextResponse.json({
        signedUrl: data.signedUrl,
        path: storagePath,
        url: publicUrl,
        filename: filename,
        contentType: contentType,
        size: size
      });
    } catch (error: any) {
      console.error('Error in signed URL generation:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Unexpected error in upload-file API route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Configure the API route to accept files up to our limit
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb' // Slightly larger than our max file size to account for overhead
    }
  }
};

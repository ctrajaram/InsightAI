import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Disable fetch cache
export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

// Set appropriate size limits for the API route
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb', // This endpoint only receives metadata, not file content
    },
    externalResolver: true,
  },
};

// Temp directory for storing chunks
const TEMP_DIR = path.join(os.tmpdir(), 'insight-ai-uploads');

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    // Verify the token with Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase configuration');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // Create two Supabase clients - one for auth and one with service role for storage operations
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { success: false, error: 'Authentication failed. Please sign in again.' },
        { status: 401 }
      );
    }
    
    // For operations that need to bypass RLS, try to use service role if available
    // But fall back to the regular client if not available
    let supabaseAdmin = supabase;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (serviceKey) {
      supabaseAdmin = createClient(supabaseUrl, serviceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    } else {
      console.warn('SUPABASE_SERVICE_KEY not found, using regular client which may have RLS restrictions');
    }
    
    // Parse the request body
    const body = await request.json();
    const { uploadId, fileName, fileType, totalChunks, transcriptionId } = body;
    
    // Validate required fields
    if (!uploadId || !fileName || !totalChunks) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields for finalization' },
        { status: 400 }
      );
    }

    // Check if the upload directory exists
    const uploadDir = path.join(TEMP_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      return NextResponse.json(
        { success: false, error: 'Upload not found' },
        { status: 404 }
      );
    }

    // Verify all chunks are present
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      if (!fs.existsSync(chunkPath)) {
        return NextResponse.json(
          { success: false, error: `Missing chunk ${i}` },
          { status: 400 }
        );
      }
    }

    // Create a temporary file to reassemble the chunks
    const tempFilePath = path.join(uploadDir, fileName);
    const writeStream = fs.createWriteStream(tempFilePath);

    // Reassemble the file from chunks
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }

    // Close the write stream and wait for it to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Read the reassembled file
    const fileBuffer = fs.readFileSync(tempFilePath);

    // Use the authenticated user's ID
    const userId = user.id;

    // Upload the reassembled file to Supabase Storage using the admin client
    const filePath = `${userId}/${Date.now()}_${fileName}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('media-files')
      .upload(filePath, fileBuffer, {
        contentType: fileType,
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading reassembled file:', uploadError);
      return NextResponse.json(
        { success: false, error: uploadError.message },
        { status: 500 }
      );
    }

    // Get the public URL for the uploaded file
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('media-files')
      .getPublicUrl(filePath);

    // Clean up the temporary files
    try {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Error cleaning up temporary files:', cleanupError);
      // Continue despite cleanup errors
    }

    // Return the success response with the file URL
    return NextResponse.json({
      success: true,
      message: 'File upload completed successfully',
      mediaUrl: publicUrl,
      transcriptionId
    });
  } catch (error: any) {
    console.error('Error finalizing upload:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to finalize upload' },
      { status: 500 }
    );
  }
}

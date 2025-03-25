import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Disable fetch cache
export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

// Set a lower size limit for the API route
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb', // Reduced from default to match our chunk size
    },
    externalResolver: true,
  },
};

// Create a temporary directory for storing chunks
// Use project directory instead of system temp which might get cleaned up
const TEMP_DIR = process.env.NODE_ENV === 'production' 
  ? path.join(os.tmpdir(), 'insight-ai-uploads')
  : path.join(process.cwd(), 'tmp', 'uploads');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`Created temporary upload directory: ${TEMP_DIR}`);
  } catch (dirError) {
    console.error(`Failed to create temporary directory ${TEMP_DIR}:`, dirError);
    // Fallback to a different directory if creation fails
    const fallbackDir = path.join(process.cwd(), 'tmp', 'fallback-uploads');
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
      console.log(`Created fallback upload directory: ${fallbackDir}`);
      // Override TEMP_DIR with the fallback
      (TEMP_DIR as any) = fallbackDir;
    } catch (fallbackError) {
      console.error(`Failed to create fallback directory:`, fallbackError);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the bearer token from the request headers
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Missing or invalid Authorization header');
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please sign in again.' },
        { status: 401 }
      );
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
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
    
    // Create a client for authentication
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Verify the user's token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Authentication error:', authError?.message || 'No user found');
      return NextResponse.json(
        { success: false, error: 'Authentication failed. Please sign in again.' },
        { status: 401 }
      );
    }
    
    // Now the user is verified, we can use their ID
    const userId = user.id;

    // Parse the multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string);
    const totalChunks = parseInt(formData.get('totalChunks') as string);
    const uploadId = formData.get('uploadId') as string;
    const transcriptionId = formData.get('transcriptionId') as string;
    const fileName = formData.get('fileName') as string;
    const fileType = formData.get('fileType') as string;
    const fileSize = parseInt(formData.get('fileSize') as string);

    // Validate required fields
    if (!file || isNaN(chunkIndex) || isNaN(totalChunks) || !uploadId || !transcriptionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Create a directory for this upload if it doesn't exist
    const uploadDir = path.join(TEMP_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Write the chunk to disk
    const chunkPath = path.join(uploadDir, `chunk-${chunkIndex}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    
    try {
      fs.writeFileSync(chunkPath, buffer);
      
      // Verify the chunk was written successfully
      if (!fs.existsSync(chunkPath)) {
        console.error(`Failed to write chunk ${chunkIndex} to ${chunkPath} (file doesn't exist after write)`);
        return NextResponse.json(
          { success: false, error: `Failed to save chunk ${chunkIndex}` },
          { status: 500 }
        );
      }
      
      const stats = fs.statSync(chunkPath);
      if (stats.size === 0) {
        console.error(`Chunk ${chunkIndex} was written but is empty (0 bytes)`);
        return NextResponse.json(
          { success: false, error: `Chunk ${chunkIndex} is empty` },
          { status: 500 }
        );
      }
      
      console.log(`Successfully wrote chunk ${chunkIndex} (${stats.size} bytes) to ${chunkPath}`);
    } catch (writeError: any) {
      console.error(`Error writing chunk ${chunkIndex} to disk:`, writeError);
      return NextResponse.json(
        { success: false, error: `Failed to save chunk: ${writeError.message}` },
        { status: 500 }
      );
    }

    // Create a metadata file if this is the first chunk
    if (chunkIndex === 0) {
      const metadata = {
        fileName,
        fileType,
        fileSize,
        totalChunks,
        transcriptionId,
        userId,
        uploadTime: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(uploadDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
    }

    // Return success
    return NextResponse.json({
      success: true,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`,
      chunkIndex,
      totalChunks,
      uploadId,
      chunkPath: chunkPath.replace(/\\/g, '/') // For debugging
    });
  } catch (error: any) {
    console.error('Error uploading chunk:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload chunk' },
      { status: 500 }
    );
  }
}

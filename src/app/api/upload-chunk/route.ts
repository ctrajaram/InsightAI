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
const TEMP_DIR = path.join(os.tmpdir(), 'insight-ai-uploads');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

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
    
    // Create a client for authentication
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
    
    // Use the authenticated user's ID instead of relying on the form data
    const userId = user.id;

    // Create a directory for this upload if it doesn't exist
    const uploadDir = path.join(TEMP_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Write the chunk to disk
    const chunkPath = path.join(uploadDir, `chunk-${chunkIndex}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(chunkPath, buffer);

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
      uploadId
    });
  } catch (error: any) {
    console.error('Error uploading chunk:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload chunk' },
      { status: 500 }
    );
  }
}

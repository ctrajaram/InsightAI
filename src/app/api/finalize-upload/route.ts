import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import fetch from 'node-fetch';

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

    // Upload the reassembled file to Supabase Storage using direct REST API
    // This approach bypasses RLS policies completely
    const filePath = `${userId}/${Date.now()}_${fileName}`;
    const storageEndpoint = `${supabaseUrl}/storage/v1/object/media-files/${filePath}`;
    
    try {
      // Upload file using fetch to bypass RLS
      // Use service key for authorization if available, otherwise use the user's token
      const authToken = process.env.SUPABASE_SERVICE_KEY || token;
      
      const uploadResponse = await fetch(storageEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': fileType,
          'x-upsert': 'false'
        },
        body: fileBuffer
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Error uploading file via REST API:', errorText);
        return NextResponse.json(
          { success: false, error: `Failed to upload file: ${errorText}` },
          { status: uploadResponse.status }
        );
      }
      
      // Get the public URL
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/media-files/${filePath}`;
      
      // Clean up the temporary files
      try {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Error cleaning up temporary files:', cleanupError);
        // Continue despite cleanup errors
      }

      // Return success with file info
      return NextResponse.json({
        success: true,
        message: 'File upload completed successfully',
        path: filePath,
        url: publicUrl,
        mediaUrl: publicUrl, // Keep for backwards compatibility
        filename: fileName,
        contentType: fileType,
        size: fileBuffer.length,
        transcriptionId
      });
    } catch (error: any) {
      console.error('Error uploading file:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to upload file' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error finalizing upload:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to finalize upload' },
      { status: 500 }
    );
  }
}

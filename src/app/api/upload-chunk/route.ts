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
// Use a more reliable location inside the project directory
const TEMP_DIR = path.join(process.cwd(), 'uploads');

// Ensure temp directory exists with proper permissions
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`Created upload directory: ${TEMP_DIR}`);
  } catch (dirError) {
    console.error(`Failed to create upload directory ${TEMP_DIR}:`, dirError);
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

    // Check for multipart form data
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      console.error('Invalid content type:', contentType);
      return NextResponse.json(
        { success: false, error: 'Must use multipart/form-data' },
        { status: 400 }
      );
    }

    // Parse the form data
    const formData = await request.formData();
    
    // Extract and validate required fields
    const file = formData.get('file') as File;
    const chunkIndexStr = formData.get('chunkIndex')?.toString();
    const totalChunksStr = formData.get('totalChunks')?.toString();
    const uploadId = formData.get('uploadId')?.toString();
    const fileName = formData.get('fileName')?.toString();
    const fileType = formData.get('fileType')?.toString();
    const fileSizeStr = formData.get('fileSize')?.toString();
    const transcriptionId = formData.get('transcriptionId')?.toString();

    // Validate required fields
    if (!file || !chunkIndexStr || !totalChunksStr || !uploadId || !fileName || !fileType) {
      console.error('Missing required fields:', { 
        hasFile: !!file, 
        chunkIndex: chunkIndexStr, 
        totalChunks: totalChunksStr, 
        uploadId, 
        fileName, 
        fileType 
      });
      return NextResponse.json(
        { success: false, error: 'Missing required fields for chunk upload' },
        { status: 400 }
      );
    }

    // Parse numeric values
    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);
    const fileSize = fileSizeStr ? parseInt(fileSizeStr, 10) : file.size;

    // Validate numeric values
    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks <= 0) {
      console.error('Invalid numeric values:', { chunkIndex, totalChunks });
      return NextResponse.json(
        { success: false, error: 'Invalid chunk index or total chunks' },
        { status: 400 }
      );
    }

    // Ensure uploadId is safe (only alphanumeric and dashes)
    if (!/^[a-zA-Z0-9-]+$/.test(uploadId)) {
      console.error('Invalid uploadId format:', uploadId);
      return NextResponse.json(
        { success: false, error: 'Invalid uploadId format' },
        { status: 400 }
      );
    }

    // Create a directory for this upload if it doesn't exist
    let uploadDir = path.join(TEMP_DIR, uploadId);
    
    try {
      // Try to create the upload directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        console.log(`Creating upload directory: ${uploadDir}`);
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      // Test write permissions on the directory
      const testFile = path.join(uploadDir, '.write-test');
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log(`Verified write permissions in ${uploadDir}`);
      } catch (writeError) {
        console.error(`No write permission in ${uploadDir}:`, writeError);
        
        // Try alternative directory
        const altUploadDir = path.join(process.cwd(), 'tmp', 'uploads', uploadId);
        console.log(`Trying alternative directory: ${altUploadDir}`);
        
        try {
          fs.mkdirSync(altUploadDir, { recursive: true });
          const altTestFile = path.join(altUploadDir, '.write-test');
          
          fs.writeFileSync(altTestFile, 'test');
          fs.unlinkSync(altTestFile);
          console.log(`Using alternative directory with confirmed write permissions: ${altUploadDir}`);
          // Use the alternative directory instead
          uploadDir = altUploadDir;
        } catch (altWriteError) {
          console.error(`No write permission in alternative directory:`, altWriteError);
          return NextResponse.json(
            { success: false, error: "Server has no write permissions for uploads" },
            { status: 500 }
          );
        }
      }
    } catch (dirError: any) {
      console.error(`Error accessing upload directory:`, dirError);
      return NextResponse.json(
        { success: false, error: `Failed to access upload directory: ${dirError.message}` },
        { status: 500 }
      );
    }

    // Write the chunk to disk
    const chunkPath = path.join(uploadDir, `chunk-${chunkIndex}`);
    
    try {
      // Convert the file to buffer
      const buffer = Buffer.from(await file.arrayBuffer());
      
      // Write the chunk synchronously
      fs.writeFileSync(chunkPath, buffer, { mode: 0o666 }); // Set permissive file permissions
      
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
      
      // Write a duplicate copy of the chunk to the /uploads directory directly
      // This is a backup approach in case the nested directory has permission issues
      try {
        const directChunkPath = path.join(TEMP_DIR, `${uploadId}-chunk-${chunkIndex}`);
        fs.writeFileSync(directChunkPath, buffer, { mode: 0o666 });
        console.log(`Wrote backup chunk to ${directChunkPath}`);
      } catch (backupError) {
        console.error('Failed to write backup chunk:', backupError);
        // Non-fatal, continue even if backup fails
      }
    } catch (writeError: any) {
      console.error(`Error writing chunk ${chunkIndex} to disk:`, writeError);
      return NextResponse.json(
        { success: false, error: `Failed to save chunk: ${writeError.message}` },
        { status: 500 }
      );
    }

    // Create a metadata file if this is the first chunk
    if (chunkIndex === 0) {
      try {
        const metadataPath = path.join(uploadDir, 'metadata.json');
        const metadata = {
          fileName,
          fileType,
          totalChunks,
          uploadId,
          fileSize,
          transcriptionId: transcriptionId || null,
          createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        console.log(`Created metadata file at ${metadataPath}`);
      } catch (metaError: any) {
        console.error(`Error writing metadata:`, metaError);
        // Continue even if metadata write fails
      }
    }

    // List contents of the upload directory to verify
    try {
      const dirContents = fs.readdirSync(uploadDir);
      console.log(`Contents of ${uploadDir} after chunk ${chunkIndex} upload:`, dirContents);
    } catch (readError) {
      console.error(`Error reading upload directory:`, readError);
    }

    // Return success
    return NextResponse.json({
      success: true,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`,
      chunkIndex,
      totalChunks,
      uploadId,
      chunkPath: chunkPath.replace(/\\/g, '/'), // For debugging
      uploadDir: uploadDir.replace(/\\/g, '/'), // For debugging
      pathMatches: uploadDir === path.join(TEMP_DIR, uploadId) // For debugging
    });
  } catch (error: any) {
    console.error('Error uploading chunk:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload chunk' },
      { status: 500 }
    );
  }
}

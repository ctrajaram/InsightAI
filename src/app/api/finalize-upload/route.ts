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

    // Get request body
    const body = await request.json();
    const { uploadId, fileName, fileType, totalChunks, transcriptionId, uploadedChunks } = body;
    
    console.log('Finalize upload request params:', {
      uploadId,
      fileName,
      fileType,
      totalChunks,
      uploadedChunksLength: uploadedChunks?.length
    });
    
    // Validate required fields
    if (!uploadId || !fileName || !fileType || !totalChunks || isNaN(totalChunks)) {
      return NextResponse.json(
        { success: false, error: "Missing required fields for upload finalization" },
        { status: 400 }
      );
    }
    
    // Ensure temp directory is accessible
    const uploadDir = path.join(TEMP_DIR, uploadId);
    
    try {
      // Try to create the upload directory if it doesn't exist (for recovery)
      if (!fs.existsSync(uploadDir)) {
        console.log(`Upload directory doesn't exist, creating: ${uploadDir}`);
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
        
        fs.mkdirSync(altUploadDir, { recursive: true });
        const altTestFile = path.join(altUploadDir, '.write-test');
        
        try {
          fs.writeFileSync(altTestFile, 'test');
          fs.unlinkSync(altTestFile);
          console.log(`Using alternative directory with confirmed write permissions: ${altUploadDir}`);
          // Use the alternative directory instead
          (uploadDir as any) = altUploadDir;
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

    // Check if the upload directory exists
    if (!fs.existsSync(uploadDir)) {
      return NextResponse.json(
        { success: false, error: 'Upload not found' },
        { status: 404 }
      );
    }

    // Verify all chunks are present
    let missingChunks = [];
    const expectedChunks = Array.from({ length: totalChunks }, (_, i) => i);
    
    // If client provided a list of uploaded chunks, use that for verification
    // This helps avoid issues where the server may have different state than the client
    const verifyChunks = uploadedChunks && Array.isArray(uploadedChunks) ? uploadedChunks : expectedChunks;
    
    console.log(`Verifying chunks: expecting ${totalChunks} chunks, client reports ${verifyChunks.length} uploaded`);
    
    for (let i = 0; i < totalChunks; i++) {
      // Check all possible locations for the chunk
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      const directChunkPath = path.join(TEMP_DIR, `${uploadId}-chunk-${i}`);
      const altChunkPath = path.join(process.cwd(), 'tmp', 'uploads', uploadId, `chunk-${i}`);
      
      console.log(`Checking for chunk ${i}:
      1. Main path: ${chunkPath}
      2. Direct path: ${directChunkPath}
      3. Alt path: ${altChunkPath}`);
      
      // Check all possible locations
      const chunkExists = 
        fs.existsSync(chunkPath) || 
        fs.existsSync(directChunkPath) || 
        fs.existsSync(altChunkPath);
        
      // Determine which path to use
      let foundChunkPath = null;
      if (fs.existsSync(chunkPath)) {
        foundChunkPath = chunkPath;
      } else if (fs.existsSync(directChunkPath)) {
        foundChunkPath = directChunkPath;
      } else if (fs.existsSync(altChunkPath)) {
        foundChunkPath = altChunkPath;
      }
      
      if (!chunkExists || !foundChunkPath) {
        console.error(`Missing chunk ${i} (not found in any location)`);
        missingChunks.push(i);
      } else {
        try {
          const stats = fs.statSync(foundChunkPath);
          if (stats.size === 0) {
            console.error(`Chunk ${i} exists at ${foundChunkPath} but is empty (0 bytes)`);
            missingChunks.push(i);
          } else {
            console.log(`Found chunk ${i} at ${foundChunkPath} (${stats.size} bytes)`);
          }
        } catch (statError) {
          console.error(`Error checking chunk ${i}:`, statError);
          missingChunks.push(i);
        }
      }
    }
    
    if (missingChunks.length > 0) {
      // List contents of upload directory for debugging
      try {
        const dirContents = fs.readdirSync(uploadDir);
        console.log(`Contents of ${uploadDir}:`, dirContents);
      } catch (readError) {
        console.error(`Error reading upload directory:`, readError);
      }
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Missing chunks: ${missingChunks.join(', ')}`,
          uploadId,
          totalChunks,
          uploadDir: uploadDir.replace(/\\/g, '/') // For debugging
        },
        { status: 400 }
      );
    }

    // Create a temporary file to reassemble the chunks
    const tempDir = path.join(process.cwd(), 'uploads', 'completed');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Use a unique name for the reassembled file
    const tempFilePath = path.join(tempDir, `${uploadId}-${fileName}`);
    const output = fs.createWriteStream(tempFilePath);
    
    // Reassemble the file from chunks
    console.log(`Reassembling file to: ${tempFilePath}`);
    
    for (let i = 0; i < totalChunks; i++) {
      // Check all possible locations for the chunk
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      const directChunkPath = path.join(TEMP_DIR, `${uploadId}-chunk-${i}`);
      const altChunkPath = path.join(process.cwd(), 'tmp', 'uploads', uploadId, `chunk-${i}`);
      
      // Determine which path to use
      let foundChunkPath = null;
      if (fs.existsSync(chunkPath)) {
        foundChunkPath = chunkPath;
      } else if (fs.existsSync(directChunkPath)) {
        foundChunkPath = directChunkPath;
      } else if (fs.existsSync(altChunkPath)) {
        foundChunkPath = altChunkPath;
      }
      
      if (!foundChunkPath) {
        console.error(`Cannot find chunk ${i} for reassembly`);
        return NextResponse.json(
          { success: false, error: `Missing chunk ${i} for reassembly` },
          { status: 400 }
        );
      }
      
      try {
        const chunkBuffer = fs.readFileSync(foundChunkPath);
        output.write(chunkBuffer);
        console.log(`Added chunk ${i} (${chunkBuffer.length} bytes) to reassembled file from ${foundChunkPath}`);
      } catch (chunkError: any) {
        console.error(`Error reading chunk ${i}:`, chunkError);
        return NextResponse.json(
          { success: false, error: `Error reassembling file: ${chunkError.message}` },
          { status: 500 }
        );
      }
    }
    
    output.end();
    
    // Wait for the write stream to finish
    await new Promise<void>((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
    });

    // Read the reassembled file
    const fileBuffer = fs.readFileSync(tempFilePath);
    console.log(`Reassembled file size: ${fileBuffer.length} bytes`);

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

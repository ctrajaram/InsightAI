import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Define response configuration
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '2mb', // Limit the response size to 2MB
  },
};

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

    // Use a fixed bucket name - we know this one exists and is set up properly
    const bucketName = 'media-files'; // This is the bucket name defined in media-storage.ts
    
    console.log(`Using fixed bucket: ${bucketName}`);
    
    // Create a storage path that follows Supabase conventions
    // Store the chunks in the user's folder to avoid permission issues
    // Important: Start with the user ID to make RLS policies work
    const chunkStoragePath = `${userId}/uploads/${uploadId}/chunk-${chunkIndex}`;
    
    try {
      // Convert the file to buffer
      const buffer = Buffer.from(await file.arrayBuffer());
      
      // Upload the chunk directly to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(chunkStoragePath, buffer, {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      
      if (uploadError) {
        console.error(`Error uploading chunk ${chunkIndex} to Supabase Storage:`, uploadError);
        return NextResponse.json(
          { success: false, error: `Failed to upload chunk to storage: ${uploadError.message}` },
          { status: 500 }
        );
      }
      
      console.log(`Successfully uploaded chunk ${chunkIndex} to ${chunkStoragePath}`);
      
      // Create metadata for the first chunk
      if (chunkIndex === 0) {
        try {
          const metadata = {
            fileName,
            fileType,
            fileSize,
            totalChunks,
            uploadId,
            createdAt: new Date().toISOString(),
            transcriptionId
          };
          
          // Store metadata in Supabase Storage
          const { data: metaData, error: metaError } = await supabase.storage
            .from(bucketName)
            .upload(`${userId}/uploads/${uploadId}/metadata.json`, JSON.stringify(metadata, null, 2), {
              contentType: 'application/json',
              upsert: true,
            });
          
          if (metaError) {
            console.error('Error storing metadata:', metaError);
            // Non-fatal, continue even if metadata upload fails
          } else {
            console.log(`Created metadata at ${userId}/uploads/${uploadId}/metadata.json`);
          }
        } catch (metaError: any) {
          console.error(`Error creating metadata:`, metaError);
          // Continue even if metadata creation fails
        }
      }
      
      // Return success response
      return NextResponse.json({
        success: true,
        message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`,
        chunkIndex,
        totalChunks,
        uploadId,
        chunkPath: chunkStoragePath,
      });
    } catch (error: any) {
      console.error(`Error processing chunk ${chunkIndex}:`, error);
      return NextResponse.json(
        { success: false, error: `Failed to process chunk: ${error.message}` },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error uploading chunk:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload chunk' },
      { status: 500 }
    );
  }
}

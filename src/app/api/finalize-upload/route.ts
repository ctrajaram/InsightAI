import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Writable } from 'stream';

// Define response configuration
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb', // For metadata only, not the actual file
    },
    responseLimit: '2mb',
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
    
    // Create a client for authentication and storage
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
    
    // Extract and validate required fields
    const { uploadId, fileName, fileType, totalChunks, uploadedChunks, transcriptionId } = body;
    
    if (!uploadId || !fileName || !fileType || !totalChunks) {
      console.error('Missing required fields:', { uploadId, fileName, fileType, totalChunks });
      return NextResponse.json(
        { success: false, error: 'Missing required fields for finalization' },
        { status: 400 }
      );
    }
    
    // Validate total chunks
    if (typeof totalChunks !== 'number' || totalChunks <= 0) {
      console.error('Invalid totalChunks:', totalChunks);
      return NextResponse.json(
        { success: false, error: 'Invalid totalChunks value' },
        { status: 400 }
      );
    }
    
    console.log(`Starting finalization for uploadId: ${uploadId}, fileName: ${fileName}, totalChunks: ${totalChunks}`);
    
    // Verify all chunks are present in Supabase Storage
    let missingChunks = [];
    const expectedChunks = Array.from({ length: totalChunks }, (_, i) => i);
    
    // If client provided a list of uploaded chunks, use that for verification
    const verifyChunks = uploadedChunks && Array.isArray(uploadedChunks) ? uploadedChunks : expectedChunks;
    
    console.log(`Verifying chunks: expecting ${totalChunks} chunks, client reports ${verifyChunks.length} uploaded`);
    
    // Check each chunk exists in storage
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `chunks/${uploadId}/chunk-${i}`;
      
      // Check if the chunk exists in storage
      const { data: chunkData, error: chunkError } = await supabase.storage
        .from('transcriptions')
        .download(chunkPath);
      
      if (chunkError || !chunkData) {
        console.error(`Missing chunk ${i} (not found in storage):`, chunkError?.message || 'No data');
        missingChunks.push(i);
      } else {
        // Check if the chunk has content
        const size = chunkData.size;
        if (size === 0) {
          console.error(`Chunk ${i} exists in storage but is empty (0 bytes)`);
          missingChunks.push(i);
        } else {
          console.log(`Found chunk ${i} in storage (${size} bytes)`);
        }
      }
    }
    
    if (missingChunks.length > 0) {
      console.error(`Missing chunks: ${missingChunks.join(', ')}`);
      return NextResponse.json(
        { success: false, error: `Missing chunks: ${missingChunks.join(', ')}` },
        { status: 400 }
      );
    }
    
    console.log('All chunks verified. Proceeding with reassembly.');
    
    // Find a suitable storage bucket
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
      console.error('Error listing storage buckets:', bucketError);
      return NextResponse.json(
        { success: false, error: `Failed to access storage: ${bucketError.message}` },
        { status: 500 }
      );
    }
    
    // Find a suitable bucket
    let bucketName = '';
    if (buckets && buckets.length > 0) {
      console.log('Available buckets:', buckets.map(b => b.name));
      // Try to find a bucket with a sensible name for media files
      const possibleBuckets = ['media', 'uploads', 'files', 'transcriptions', 'attachments', 'audio'];
      for (const name of possibleBuckets) {
        if (buckets.some(b => b.name === name)) {
          bucketName = name;
          break;
        }
      }
      
      // If none of the preferred buckets exist, use the first available one
      if (!bucketName && buckets.length > 0) {
        bucketName = buckets[0].name;
      }
    }
    
    if (!bucketName) {
      console.error('No storage buckets available');
      return NextResponse.json(
        { success: false, error: 'No storage buckets available' },
        { status: 500 }
      );
    }
    
    console.log(`Using bucket: ${bucketName}`);
    
    // Create a buffer to hold the reassembled file
    let fileBuffer = Buffer.alloc(0);
    
    // Reassemble the file from chunks
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `chunks/${uploadId}/chunk-${i}`;
      
      // Download the chunk from storage
      const { data: chunkData, error: chunkError } = await supabase.storage
        .from(bucketName)
        .download(chunkPath);
      
      if (chunkError || !chunkData) {
        console.error(`Error downloading chunk ${i}:`, chunkError?.message || 'No data');
        return NextResponse.json(
          { success: false, error: `Error downloading chunk ${i}: ${chunkError?.message || 'Unknown error'}` },
          { status: 500 }
        );
      }
      
      // Convert the chunk to buffer and append it
      const chunkBuffer = Buffer.from(await chunkData.arrayBuffer());
      fileBuffer = Buffer.concat([fileBuffer, chunkBuffer]);
      console.log(`Added chunk ${i} (${chunkBuffer.length} bytes) to reassembled file`);
    }
    
    console.log(`Reassembled file size: ${fileBuffer.length} bytes`);
    
    // Generate a unique filename for the complete file
    const safeFileName = fileName.replace(/[^a-zA-Z0-9\._-]/g, '_');
    const uniqueFileName = `${Date.now()}-${safeFileName}`;
    const storagePath = `${userId}/${uniqueFileName}`;
    
    // Upload the complete file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileBuffer, {
        contentType: fileType,
        upsert: false,
      });
    
    if (uploadError) {
      console.error('Error uploading complete file to storage:', uploadError);
      return NextResponse.json(
        { success: false, error: `Failed to upload complete file: ${uploadError.message}` },
        { status: 500 }
      );
    }
    
    console.log(`Uploaded complete file to ${storagePath}`);
    
    // Get public URL for the file
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);
    
    // Create a record in the transcriptions table
    let transcriptionData;
    try {
      // Use the provided transcriptionId if available, otherwise generate a new one
      const finalTranscriptionId = transcriptionId || randomUUID();
      
      // Insert the transcription record
      const { data, error } = await supabase
        .from('transcriptions')
        .insert([
          {
            id: finalTranscriptionId,
            user_id: userId,
            filename: fileName,
            filetype: fileType,
            status: 'pending',
            media_path: storagePath,
            media_url: publicUrl,
            upload_id: uploadId,
          }
        ])
        .select()
        .single();
      
      if (error) {
        console.error('Error creating transcription record:', error);
        return NextResponse.json(
          { success: false, error: `Failed to create transcription record: ${error.message}` },
          { status: 500 }
        );
      }
      
      transcriptionData = data;
      console.log('Created transcription record:', data.id);
    } catch (dbError: any) {
      console.error('Error creating transcription record:', dbError);
      return NextResponse.json(
        { success: false, error: `Failed to create transcription record: ${dbError.message}` },
        { status: 500 }
      );
    }
    
    // Clean up the temporary chunks (optional, can be done asynchronously)
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = `chunks/${uploadId}/chunk-${i}`;
        
        supabase.storage
          .from(bucketName)
          .remove([chunkPath])
          .then(({ error }) => {
            if (error) {
              console.error(`Error removing chunk ${i}:`, error);
            }
          });
      }
      
      // Also remove the metadata file
      supabase.storage
        .from(bucketName)
        .remove([`chunks/${uploadId}/metadata.json`])
        .then(({ error }) => {
          if (error) {
            console.error('Error removing metadata file:', error);
          }
        });
      
      console.log(`Initiated cleanup of temporary chunks for upload ${uploadId}`);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
      // Non-fatal, continue even if cleanup fails
    }
    
    // Return success with the transcription data
    return NextResponse.json({
      success: true,
      message: 'File upload complete',
      transcription: transcriptionData,
      filePath: storagePath,
      fileUrl: publicUrl,
    });
  } catch (error: any) {
    console.error('Error finalizing upload:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to finalize upload' },
      { status: 500 }
    );
  }
}

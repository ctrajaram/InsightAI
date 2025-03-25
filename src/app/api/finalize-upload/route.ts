import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
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
    // Authenticate the user
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse the request body
    const body = await request.json();
    const { uploadId, transcriptionId, fileName, fileType, totalChunks } = body;

    // Validate required fields
    if (!uploadId || !transcriptionId || !fileName || !fileType || !totalChunks) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
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

    // Upload the reassembled file to Supabase Storage
    const filePath = `${session.user.id}/${Date.now()}_${fileName}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('media')
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
    const { data: { publicUrl } } = supabase.storage
      .from('media')
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

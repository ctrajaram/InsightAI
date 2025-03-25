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

// Create a temporary directory for storing chunks
const TEMP_DIR = path.join(os.tmpdir(), 'insight-ai-uploads');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

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
    fs.writeFileSync(chunkPath, buffer);

    // Create a metadata file if this is the first chunk
    if (chunkIndex === 0) {
      const metadata = {
        fileName,
        fileType,
        fileSize,
        totalChunks,
        transcriptionId,
        userId: session.user.id,
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

import { v4 as uuidv4 } from 'uuid';
import { createSupabaseBrowserClient } from './supabase';

// Define bucket name for media files
export const MEDIA_BUCKET = 'media-files';

// Try alternative bucket names if needed
const ALTERNATIVE_BUCKET_NAMES = ['mediafiles', 'media_files', 'MediaFiles'];

// Interface for uploaded file information
export interface UploadedFileInfo {
  path: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

// Interface for the transcription record
export interface TranscriptionRecord {
  id: string;
  mediaPath: string;
  mediaUrl: string;
  transcriptionText: string;
  summaryText?: string;
  summaryStatus?: 'pending' | 'processing' | 'completed' | 'error';
  analysisStatus?: 'pending' | 'processing' | 'completed' | 'error';
  analysisData?: {
    sentiment: 'positive' | 'neutral' | 'negative';
    sentiment_explanation: string;
    pain_points: Array<{
      issue: string;
      description: string;
      quotes: string[];
    }>;
    feature_requests: Array<{
      feature: string;
      description: string;
      quotes: string[];
    }>;
    topics?: Array<{
      topic: string;
      description: string;
      quotes: string[];
    }>;
    keyInsights?: Array<{
      insight: string;
      description: string;
      quotes: string[];
    }>;
  };
  createdAt: string;
  fileName: string;
  fileSize: number;
  duration?: number;
  status: 'processing' | 'completed' | 'error' | 'partial';
  error?: string;
}

/**
 * Maps database record (snake_case) to TranscriptionRecord interface (camelCase)
 */
export function mapDbRecordToTranscriptionRecord(dbRecord: any): TranscriptionRecord {
  return {
    id: dbRecord.id,
    mediaPath: dbRecord.media_path,
    mediaUrl: dbRecord.media_url,
    transcriptionText: dbRecord.transcription_text || '',
    summaryText: dbRecord.summary_text,
    summaryStatus: dbRecord.summary_status,
    analysisStatus: dbRecord.analysis_status,
    analysisData: dbRecord.analysis_data,
    createdAt: dbRecord.created_at,
    fileName: dbRecord.file_name,
    fileSize: dbRecord.file_size,
    duration: dbRecord.duration,
    status: dbRecord.status,
    error: dbRecord.error
  };
}

// Uploads a file to Supabase storage
export async function uploadMediaFile(file: File, userId: string): Promise<UploadedFileInfo> {
  const supabase = createSupabaseBrowserClient();
  
  // Generate a unique filename to avoid collisions
  const timestamp = Date.now();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9\._-]/g, '_');
  const uniqueFileName = `${timestamp}-${safeFileName}`;
  
  // Store in user's folder for proper permissions
  const storagePath = `${userId}/${uniqueFileName}`;
  
  console.log(`Attempting to upload file to ${MEDIA_BUCKET}/${storagePath}`);
  
  // Try with the primary bucket name first
  let uploadResult = await tryUploadToStorage(supabase, MEDIA_BUCKET, storagePath, file);
  
  // If primary bucket fails, try alternative bucket names
  if (!uploadResult.success && uploadResult.error?.includes('bucket')) {
    console.log('Primary bucket upload failed, trying alternatives...');
    
    for (const bucketName of ALTERNATIVE_BUCKET_NAMES) {
      console.log(`Trying alternative bucket: ${bucketName}`);
      uploadResult = await tryUploadToStorage(supabase, bucketName, storagePath, file);
      
      if (uploadResult.success) {
        console.log(`Successfully uploaded to alternative bucket: ${bucketName}`);
        break;
      }
    }
  }
  
  // If all attempts failed, throw the error
  if (!uploadResult.success) {
    throw new Error(uploadResult.error || 'Failed to upload file to any storage bucket');
  }
  
  // Get the public URL for the file from the successful bucket
  const { data: { publicUrl } } = supabase.storage
    .from(uploadResult.bucketName || MEDIA_BUCKET)
    .getPublicUrl(storagePath);
  
  console.log('File uploaded successfully with public URL:', publicUrl);
  
  return {
    path: storagePath,
    url: publicUrl,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  };
}

// Helper function to try uploading to a specific bucket
async function tryUploadToStorage(
  supabase: any, 
  bucketName: string, 
  storagePath: string, 
  file: File
): Promise<{ success: boolean; error?: string; bucketName?: string }> {
  try {
    // First try to list files to check permissions
    const { data: listData, error: listError } = await supabase.storage
      .from(bucketName)
      .list(storagePath.split('/')[0], { limit: 1 });
    
    if (listError) {
      console.log(`Permission check failed for bucket '${bucketName}':`, listError.message);
      // Continue anyway, as this might just be a policy that prevents listing but allows uploads
    } else {
      console.log(`Successfully listed files in bucket '${bucketName}'`);
    }
    
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true, // Use upsert to avoid conflicts
      });
    
    if (error) {
      console.error(`Error uploading to bucket '${bucketName}':`, error.message);
      
      // Check for specific error types
      if (error.message.includes('row-level security policy')) {
        return { 
          success: false, 
          error: `Permission denied. Please ensure the storage bucket has proper RLS policies configured for user uploads.` 
        };
      }
      
      return { success: false, error: error.message };
    }
    
    return { success: true, bucketName };
  } catch (error: any) {
    console.error(`Exception uploading to bucket '${bucketName}':`, error);
    return { success: false, error: error.message };
  }
}

// Deletes a file from Supabase storage
export async function deleteMediaFile(filePath: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  
  try {
    console.log(`Attempting to delete file: ${MEDIA_BUCKET}/${filePath}`);
    
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .remove([filePath]);
    
    if (error) {
      console.error('Error deleting file from Supabase Storage:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
    
    console.log('File deleted successfully');
  } catch (error: any) {
    console.error('Error in deleteMediaFile:', error);
    throw error;
  }
}

/**
 * Creates a transcription record in the database
 */
export async function createTranscriptionRecord(
  fileInfo: UploadedFileInfo,
  userId: string
): Promise<TranscriptionRecord> {
  const supabase = createSupabaseBrowserClient();
  
  const newRecord = {
    id: uuidv4(),
    user_id: userId,
    media_path: fileInfo.path,
    media_url: fileInfo.url,
    file_name: fileInfo.filename,
    file_size: fileInfo.size,
    content_type: fileInfo.contentType,
    status: 'processing',
    created_at: new Date().toISOString(),
    transcription_text: '', // Add default empty values for required fields
    error: null,
  };
  
  console.log('Creating transcription record with ID:', newRecord.id);
  console.log('Record data:', newRecord);
  
  // Try up to 3 times to create the record
  let attempts = 0;
  let data;
  let error;
  
  while (attempts < 3) {
    attempts++;
    const result = await supabase
      .from('transcriptions')
      .insert(newRecord)
      .select()
      .single();
    
    data = result.data;
    error = result.error;
    
    if (!error) break;
    
    console.error(`Attempt ${attempts} failed:`, error.message);
    
    if (attempts < 3) {
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`Retrying... (attempt ${attempts + 1})`);
    }
  }
  
  if (error) {
    console.error('All attempts to create transcription record failed:', error);
    
    // Get table structure to help diagnose the issue
    const { data: tableInfo } = await supabase
      .from('transcriptions')
      .select('*')
      .limit(1);
    
    console.log('Table structure sample:', tableInfo);
    
    throw new Error(`Failed to create transcription record: ${error.message}`);
  }
  
  console.log('Transcription record created in database:', data);
  
  // Verify the record was created
  const { data: verifyData, error: verifyError } = await supabase
    .from('transcriptions')
    .select('id')
    .eq('id', newRecord.id)
    .single();
  
  if (verifyError) {
    console.error('Record created but failed verification:', verifyError);
  } else {
    console.log('Record verified in database:', verifyData);
  }
  
  // Map database field names to our TypeScript interface
  return mapDbRecordToTranscriptionRecord(data);
}

/**
 * Updates a transcription record with the completed transcription
 */
export async function updateTranscriptionRecord(
  transcriptionId: string,
  transcriptionText: string,
  duration?: number
): Promise<TranscriptionRecord> {
  const supabase = createSupabaseBrowserClient();
  
  const { data, error } = await supabase
    .from('transcriptions')
    .update({
      transcription_text: transcriptionText,
      duration: duration,
      status: 'completed',
      summary_status: 'pending', // Mark as pending summary generation
      updated_at: new Date().toISOString()
    })
    .eq('id', transcriptionId)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating transcription record:', error.message);
    throw new Error(`Failed to update transcription record: ${error.message}`);
  }
  
  return mapDbRecordToTranscriptionRecord(data);
}
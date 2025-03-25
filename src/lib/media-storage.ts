import { v4 as uuidv4 } from 'uuid';
import { createSupabaseBrowserClient } from './supabase';

// Define bucket name for media files
const MEDIA_BUCKET = 'media-files';

// Interface for the uploaded file info
export interface UploadedFileInfo {
  path: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  transcription?: any; 
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
  status: 'processing' | 'completed' | 'error';
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

/**
 * Uploads a file to Supabase storage
 */
export async function uploadMediaFile(file: File, userId: string): Promise<UploadedFileInfo> {
  const supabase = createSupabaseBrowserClient();
  
  // Generate a unique filename to avoid collisions
  const timestamp = Date.now();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9\._-]/g, '_');
  const uniqueFileName = `${timestamp}-${safeFileName}`;
  
  // Store in user's folder for proper permissions
  const storagePath = `${userId}/${uniqueFileName}`;
  
  try {
    console.log(`Attempting to upload file to ${MEDIA_BUCKET}/${storagePath}`);
    
    // Upload file to Supabase Storage
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });
    
    if (error) {
      console.error('Error uploading file to Supabase Storage:', error);
      
      // Check if this is a bucket not found error
      if (error.message.includes('bucket') && error.message.includes('not found')) {
        throw new Error(`Storage bucket '${MEDIA_BUCKET}' not found. Please create this bucket in your Supabase dashboard.`);
      }
      
      // Check if this is an RLS policy error
      if (error.message.includes('row-level security policy')) {
        throw new Error(`Permission denied. Please ensure the storage bucket has proper RLS policies configured for user uploads.`);
      }
      
      throw new Error(`Failed to upload file: ${error.message}`);
    }
    
    // Get the public URL for the file
    const { data: { publicUrl } } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(storagePath);
    
    console.log('File uploaded successfully with public URL:', publicUrl);
    
    return {
      path: storagePath,
      url: publicUrl,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  } catch (error: any) {
    console.error('Error in uploadMediaFile:', error);
    throw error; // Re-throw to preserve the specific error message
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

/**
 * Gets all transcription records for a user
 */
export async function getUserTranscriptions(userId: string): Promise<TranscriptionRecord[]> {
  const supabase = createSupabaseBrowserClient();
  
  const { data, error } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching transcriptions:', error.message);
    throw new Error(`Failed to fetch transcriptions: ${error.message}`);
  }
  
  return (data || []).map(record => mapDbRecordToTranscriptionRecord(record));
}

/**
 * Marks a transcription record as failed
 */
export async function markTranscriptionError(
  transcriptionId: string,
  errorMessage: string
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  
  const { error } = await supabase
    .from('transcriptions')
    .update({
      status: 'error',
      error: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq('id', transcriptionId);
  
  if (error) {
    console.error('Error updating transcription error status:', error.message);
    throw new Error(`Failed to update transcription error status: ${error.message}`);
  }
}

/**
 * Updates the transcription record with summary info
 */
export async function updateTranscriptionWithSummary(
  transcriptionId: string,
  summaryText: string
): Promise<TranscriptionRecord> {
  const supabase = createSupabaseBrowserClient();
  
  const { data, error } = await supabase
    .from('transcriptions')
    .update({
      summary_text: summaryText,
      summary_status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', transcriptionId)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating summary in transcription record:', error.message);
    throw new Error(`Failed to update summary in transcription record: ${error.message}`);
  }
  
  return mapDbRecordToTranscriptionRecord(data);
}

/**
 * Requests an AI-generated summary for a transcription
 * 
 * @deprecated Use the direct API call from the component instead
 */
export async function generateSummary(transcriptionId: string, transcriptionText: string): Promise<string> {
  console.warn('This function is deprecated. Please use the direct API call from the component instead');
  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcriptionId,
        transcriptionText,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate summary');
    }

    const data = await response.json();
    return data.summary.text;
  } catch (error: any) {
    console.error('Error generating summary:', error.message);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
} 
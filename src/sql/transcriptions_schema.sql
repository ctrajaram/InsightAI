-- Create transcriptions table
CREATE TABLE IF NOT EXISTS transcriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_path TEXT NOT NULL,
  media_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  duration INTEGER, -- in seconds
  transcription_text TEXT,
  summary_text TEXT, -- Added field for AI-generated summary
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'error')),
  summary_status TEXT CHECK (summary_status IN ('pending', 'processing', 'completed', 'error')),  -- Added field for summary status
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE
);

-- Set up Row Level Security (RLS) policies
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to see only their own transcriptions
CREATE POLICY "Users can view their own transcriptions" 
ON transcriptions FOR SELECT 
USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own transcriptions
CREATE POLICY "Users can insert their own transcriptions" 
ON transcriptions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own transcriptions
CREATE POLICY "Users can update their own transcriptions" 
ON transcriptions FOR UPDATE 
USING (auth.uid() = user_id);

-- Create media bucket for storing audio/video files
INSERT INTO storage.buckets (id, name, public) VALUES 
('media-files', 'media-files', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for storage
CREATE POLICY "Public users can read media files"
ON storage.objects FOR SELECT
USING (bucket_id = 'media-files');

CREATE POLICY "Authenticated users can upload media files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'media-files' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
);

CREATE POLICY "Users can update their own media files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'media-files' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
);

CREATE POLICY "Users can delete their own media files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'media-files' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
); 
-- Add rev_ai_job_id column to transcriptions table
ALTER TABLE transcriptions 
ADD COLUMN rev_ai_job_id TEXT;

-- Create an index for faster lookups by rev_ai_job_id
CREATE INDEX idx_transcriptions_rev_ai_job_id ON transcriptions(rev_ai_job_id);

-- Optional: Add a comment to the column for documentation
COMMENT ON COLUMN transcriptions.rev_ai_job_id IS 'Rev AI job ID for webhook callbacks';

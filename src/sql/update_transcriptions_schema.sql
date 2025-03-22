-- Add new summary columns (safe to run even if columns already exist)
ALTER TABLE transcriptions 
ADD COLUMN IF NOT EXISTS summary_text TEXT,
ADD COLUMN IF NOT EXISTS summary_status TEXT CHECK (summary_status IN ('pending', 'processing', 'completed', 'error'));

-- Add comment to the columns for documentation
COMMENT ON COLUMN transcriptions.summary_text IS 'AI-generated summary of the transcription';
COMMENT ON COLUMN transcriptions.summary_status IS 'Status of the summary generation process';

-- Set default value for summary_status on existing records
UPDATE transcriptions 
SET summary_status = 'pending' 
WHERE summary_status IS NULL AND transcription_text IS NOT NULL;

-- Set default value for summary_status on future records (optional)
ALTER TABLE transcriptions 
ALTER COLUMN summary_status SET DEFAULT 'pending';

-- Update the table validation constraints if needed
ALTER TABLE transcriptions
DROP CONSTRAINT IF EXISTS transcriptions_summary_status_check;

ALTER TABLE transcriptions
ADD CONSTRAINT transcriptions_summary_status_check 
CHECK (summary_status IN ('pending', 'processing', 'completed', 'error'));

-- Notify that the update is complete
DO $$
BEGIN
  RAISE NOTICE 'Transcriptions table updated successfully with summary fields';
END $$; 
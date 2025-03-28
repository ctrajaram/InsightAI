-- Create a stored procedure to find transcriptions by job ID with fuzzy matching
CREATE OR REPLACE FUNCTION find_transcription_by_job_id_fuzzy(job_id_param TEXT)
RETURNS SETOF transcriptions AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM transcriptions
  WHERE 
    -- Case-insensitive match
    LOWER(rev_ai_job_id) = LOWER(job_id_param)
    -- Or job ID contains the parameter (for partial matches)
    OR LOWER(rev_ai_job_id) LIKE LOWER('%' || job_id_param || '%')
    -- Or parameter contains the job ID (for partial matches in the other direction)
    OR LOWER(job_id_param) LIKE LOWER('%' || rev_ai_job_id || '%')
  ORDER BY created_at DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

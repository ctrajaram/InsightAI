// Type definitions for the InsightAI application

// Transcription record type with analysis data
export interface TranscriptionRecord {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  transcriptionText: string;
  summaryText?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  mediaType: 'audio' | 'video' | 'text';
  duration?: number;
  analysisData: {
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
    topics: string[];
    keyInsights: string[];
    [key: string]: any; // Allow for additional fields
  };
  analysisStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  summaryStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

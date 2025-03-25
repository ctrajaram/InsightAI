import { TranscriptionRecord } from "@/types";

/**
 * Updates the analysis data for a transcription in the database
 * @param transcriptionId - The ID of the transcription to update
 * @param analysisData - The analysis data to store
 * @param accessToken - The user's access token
 * @returns The updated transcription record
 */
export async function updateAnalysisData(
  transcriptionId: string, 
  analysisData: any, 
  accessToken: string
): Promise<TranscriptionRecord | null> {
  try {
    console.log('Updating analysis data for transcription:', transcriptionId);
    
    // Ensure we have a valid analysis data structure
    const formattedAnalysisData = {
      sentiment: analysisData.sentiment || 'neutral',
      sentiment_explanation: analysisData.sentiment_explanation || 'No explanation available',
      pain_points: Array.isArray(analysisData.pain_points) ? analysisData.pain_points : [],
      feature_requests: Array.isArray(analysisData.feature_requests) ? analysisData.feature_requests : [],
      ...analysisData // Keep any other analysis data fields
    };
    
    const response = await fetch('/api/transcription/update-analysis', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        transcriptionId,
        analysisData: formattedAnalysisData,
        accessToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to update analysis data:', errorData);
      throw new Error(errorData.error || 'Failed to update analysis data');
    }
    
    const data = await response.json();
    console.log('Analysis data updated successfully:', data);
    
    return data.transcription || null;
  } catch (error) {
    console.error('Error updating analysis data:', error);
    return null;
  }
}

/**
 * Maps analysis data from the UI format to the database format
 * @param uiAnalysisData - The analysis data from the UI
 * @returns The formatted analysis data for database storage
 */
export function formatAnalysisDataForDb(uiAnalysisData: any): any {
  return {
    sentiment: uiAnalysisData.sentiment || 'neutral',
    sentiment_explanation: uiAnalysisData.sentimentExplanation || 'No explanation available',
    pain_points: Array.isArray(uiAnalysisData.painPoints) ? uiAnalysisData.painPoints : [],
    feature_requests: Array.isArray(uiAnalysisData.featureRequests) ? uiAnalysisData.featureRequests : [],
    key_insights: Array.isArray(uiAnalysisData.keyInsights) ? uiAnalysisData.keyInsights : [],
    topics: Array.isArray(uiAnalysisData.topics) ? uiAnalysisData.topics : []
  };
}

/**
 * Maps analysis data from the database format to the UI format
 * @param dbAnalysisData - The analysis data from the database
 * @returns The formatted analysis data for UI display
 */
export function formatAnalysisDataForUi(dbAnalysisData: any): any {
  // Handle case where analysis data is a string
  let parsedData = dbAnalysisData;
  if (typeof dbAnalysisData === 'string') {
    try {
      parsedData = JSON.parse(dbAnalysisData);
    } catch (e) {
      console.error('Error parsing analysis data string:', e);
      parsedData = {};
    }
  }
  
  return {
    sentiment: parsedData?.sentiment || 'neutral',
    sentimentExplanation: parsedData?.sentiment_explanation || 'No explanation available',
    painPoints: Array.isArray(parsedData?.pain_points) ? parsedData.pain_points : [],
    featureRequests: Array.isArray(parsedData?.feature_requests) ? parsedData.feature_requests : [],
    keyInsights: Array.isArray(parsedData?.key_insights) ? parsedData.key_insights : [],
    topics: Array.isArray(parsedData?.topics) ? parsedData.topics : []
  };
}

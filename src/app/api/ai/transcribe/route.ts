import openai from '@/lib/openai';
import { NextRequest } from 'next/server';

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req: NextRequest) {
  try {
    // Get the form data
    const formData = await req.formData();
    
    // Get the audio file from the form data
    const audioFile = formData.get('audio') as File;
    
    if (!audioFile) {
      return new Response('Audio file is required', { status: 400 });
    }

    // Convert File to Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });

    // Create a FormData instance
    const transcriptionFormData = new FormData();
    transcriptionFormData.append('file', audioBlob, audioFile.name);
    transcriptionFormData.append('model', 'whisper-1');

    // Call the OpenAI transcription API
    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: audioBlob,
      model: 'whisper-1',
    });

    return new Response(JSON.stringify({ 
      transcript: transcriptionResponse.text 
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return new Response('Error processing your request', { status: 500 });
  }
} 
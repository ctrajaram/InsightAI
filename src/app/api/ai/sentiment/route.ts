import { StreamingTextResponse } from 'ai';
import openai from '@/lib/openai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text) {
      return new Response('Text is required', { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      stream: true,
      messages: [
        {
          role: 'system',
          content: 'You are a sentiment analysis assistant. Analyze the sentiment of the given text and categorize it as positive, negative, or neutral. Provide a brief explanation for your analysis.'
        },
        {
          role: 'user',
          content: text
        }
      ],
    });
    
    // Return a StreamingTextResponse, which will stream the response
    return new StreamingTextResponse(response.body);
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return new Response('Error processing your request', { status: 500 });
  }
} 
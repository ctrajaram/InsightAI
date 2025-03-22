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
          content: 'You are a helpful assistant that summarizes text. Provide a concise summary of the text provided.'
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
    console.error('Error summarizing text:', error);
    return new Response('Error processing your request', { status: 500 });
  }
} 
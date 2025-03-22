import openai from '@/lib/openai';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    // A simple non-streaming API call to test OpenAI connection
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that responds with very short answers.'
        },
        {
          role: 'user',
          content: 'Hello! Can you confirm the AI SDK is working?'
        }
      ],
    });

    return NextResponse.json({
      success: true,
      message: completion.choices[0]?.message?.content || 'No response content',
      model: completion.model,
      apiKeyConfigured: process.env.OPENAI_API_KEY ? true : false
    });
  } catch (error: any) {
    console.error('Error testing OpenAI:', error);
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error',
      apiKeyConfigured: process.env.OPENAI_API_KEY ? true : false
    }, { status: 500 });
  }
} 
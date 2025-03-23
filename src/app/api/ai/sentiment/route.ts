import { NextRequest, NextResponse } from 'next/server';
import openai from '@/lib/openai';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Generate sentiment analysis response with OpenAI API - non-streaming for compatibility
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a sentiment analysis expert. Analyze the sentiment of the text and provide a detailed response.' },
        { role: 'user', content: `Analyze the sentiment of the following text: ${text}` }
      ],
      stream: false,
      temperature: 0.6,
      max_tokens: 500,
    });
    
    // Return a regular JSON response instead of streaming
    const content = response.choices[0]?.message?.content || '';
    return NextResponse.json({ result: content });
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return NextResponse.json({ error: 'Error processing your request' }, { status: 500 });
  }
}
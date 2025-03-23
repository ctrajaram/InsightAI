import { NextRequest, NextResponse } from 'next/server';
import openai from '@/lib/openai';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Generate summarization response with OpenAI API - non-streaming for compatibility
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a summarization expert. Provide a concise summary of the text.' },
        { role: 'user', content: `Summarize the following text: ${text}` }
      ],
      stream: false,
      temperature: 0.5,
      max_tokens: 500,
    });
    
    // Return a regular JSON response instead of streaming
    const content = response.choices[0]?.message?.content || '';
    return NextResponse.json({ result: content });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json({ error: 'Error processing your request' }, { status: 500 });
  }
}
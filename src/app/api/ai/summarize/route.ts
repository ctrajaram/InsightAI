import { NextRequest, NextResponse } from 'next/server';
import openai from '@/lib/openai';

// Add debug logging for environment variables
console.log('SUMMARIZE API: Environment variables check:', {
  openaiApiKey: !!process.env.OPENAI_API_KEY ? 'Set' : 'Missing',
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV
});

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    console.log('SUMMARIZE API: POST request received');
    const { text } = await req.json();

    if (!text) {
      console.log('SUMMARIZE API: Missing text in request');
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    console.log('SUMMARIZE API: Text received, length:', text.length);
    
    // Check if OpenAI client is initialized
    if (!openai) {
      console.error('SUMMARIZE API: OpenAI client not initialized');
      return NextResponse.json({ 
        error: 'Server configuration error: AI client not initialized' 
      }, { status: 500 });
    }
    
    // Generate summarization response with OpenAI API - non-streaming for compatibility
    console.log('SUMMARIZE API: Calling OpenAI API');
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
    console.log('SUMMARIZE API: Summary generated, length:', content.length);
    return NextResponse.json({ result: content });
  } catch (error) {
    console.error('SUMMARIZE API: Error generating summary:', error);
    return NextResponse.json({ 
      error: 'Error processing your request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
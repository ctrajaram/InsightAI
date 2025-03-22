import OpenAI from 'openai';

// Create an OpenAI API client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  organization: process.env.OPENAI_ORGANIZATION,
});

// Validate the API key is provided
if (!process.env.OPENAI_API_KEY) {
  console.warn('Missing OPENAI_API_KEY environment variable');
}

export default openai; 
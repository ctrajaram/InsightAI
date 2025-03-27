import OpenAI from 'openai';

// Initialize environment variables
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const openaiOrg = process.env.OPENAI_ORGANIZATION;

// Declare OpenAI client variable but don't initialize it yet
let openai: OpenAI | null = null;

// Only initialize if we have the necessary environment variables and we're on the server
// This prevents errors during build time when env vars aren't available
if (typeof window === 'undefined' && openaiApiKey) {
  try {
    // Create OpenAI client
    openai = new OpenAI({
      apiKey: openaiApiKey,
      organization: openaiOrg,
    });
    console.log('OpenAI client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize OpenAI client:', error);
    openai = null;
  }
} else if (!openaiApiKey) {
  console.warn('Missing OPENAI_API_KEY environment variable');
}

export { openai };
export default openai;
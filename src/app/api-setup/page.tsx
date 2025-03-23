'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Navbar from "@/components/ui/navbar";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function ApiSetupPage() {
  const [openAiKey, setOpenAiKey] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const envContent = `# OpenAI API Keys
OPENAI_API_KEY=${openAiKey}

# Optional: Organization ID if you're using an organization in OpenAI
# OPENAI_ORGANIZATION=your-organization-id

# Supabase Configuration - Keep your existing Supabase configuration`;

    navigator.clipboard.writeText(envContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold">API Setup Guide</h1>
            <p className="text-lg text-indigo-600 mt-2">
              Configure your API keys for the transcription and summarization features
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>OpenAI API Key Setup</CardTitle>
              <CardDescription>
                You need a valid OpenAI API key to use the transcription and summarization features
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Step 1: Get an OpenAI API Key</h3>
                <p>Visit the <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenAI API Keys page</a> to create an API key.</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">Step 2: Enter your API Key</h3>
                <div className="flex gap-2">
                  <Input 
                    type="text" 
                    value={openAiKey} 
                    onChange={(e) => setOpenAiKey(e.target.value)}
                    placeholder="sk-..." 
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">Step 3: Update your .env.local file</h3>
                <p>Copy the following content and paste it into your <code className="bg-gray-100 px-1 py-0.5 rounded">.env.local</code> file:</p>
                <div className="bg-gray-100 p-4 rounded-md font-mono text-sm whitespace-pre">
{`# OpenAI API Keys
OPENAI_API_KEY=${openAiKey || 'your-openai-api-key'}

# Optional: Organization ID if you're using an organization in OpenAI
# OPENAI_ORGANIZATION=your-organization-id

# Supabase Configuration - Keep your existing Supabase configuration`}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">Step 4: Restart your development server</h3>
                <p>After updating the .env.local file, restart your Next.js development server:</p>
                <div className="bg-gray-100 p-3 rounded-md font-mono text-sm">
                  npm run dev
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleCopy} className="w-full">
                {copied ? 'Copied!' : 'Copy Environment Variables'}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Troubleshooting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-md font-medium">Common Issues:</h3>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>Make sure your OpenAI API key is valid and has not expired</li>
                  <li>Check that your OpenAI account has billing set up for API usage</li>
                  <li>Ensure your .env.local file is in the root directory of your project</li>
                  <li>Verify that the OPENAI_API_KEY variable is correctly set without any typos</li>
                  <li>After updating .env.local, restart your development server completely</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
} 
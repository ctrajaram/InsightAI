'use client';

import { useState, useEffect } from 'react';
import { Navbar } from "@/components/ui/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function AITestPage() {
  const [testResult, setTestResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testAIConnection = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/ai/test');
      const data = await response.json();
      setTestResult(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred during the test');
      setTestResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto py-10">
        <div className="flex flex-col gap-8">
          <div className="text-center">
            <h1 className="text-5xl font-bold tracking-tight mb-4 ai-header">AI SDK Integration Test</h1>
            <p className="text-xl text-indigo-600 max-w-2xl mx-auto">
              Test your Vercel AI SDK and OpenAI integration with a sleek, colorful interface
            </p>
          </div>

          <Card className="colorful-card mx-auto max-w-3xl">
            <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-t-lg">
              <CardTitle className="text-2xl text-indigo-700">OpenAI Integration Test</CardTitle>
              <CardDescription className="text-indigo-500 font-medium">
                Click the button below to test your OpenAI connection
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="mb-6 text-gray-700">
                This test will make a simple request to OpenAI to verify your integration is working correctly.
                The test uses gpt-3.5-turbo to send a simple message and checks if a response is received.
              </p>
              <div className="flex justify-center">
                <Button 
                  onClick={testAIConnection} 
                  disabled={isLoading}
                  size="lg"
                  className="test-btn"
                >
                  {isLoading ? 'Testing...' : 'Test Connection'}
                </Button>
              </div>
            </CardContent>
            {(testResult || error) && (
              <CardFooter className="flex flex-col items-start">
                <h3 className="font-semibold text-lg mb-2 text-indigo-700">Test Results:</h3>
                {error && (
                  <div className="error-box w-full">
                    <p className="font-medium text-red-700">Error: {error}</p>
                  </div>
                )}
                {testResult && (
                  <div className={`w-full ${testResult.success ? 'success-box' : 'error-box'}`}>
                    <p className="font-medium text-lg mb-2">{testResult.success ? '✅ Success!' : '❌ Failed'}</p>
                    {testResult.message && (
                      <p className="mt-2">
                        <span className="font-semibold">Response:</span> {testResult.message}
                      </p>
                    )}
                    {testResult.model && (
                      <p className="mt-2">
                        <span className="font-semibold">Model:</span> <span className="text-indigo-600 font-medium">{testResult.model}</span>
                      </p>
                    )}
                    <p className="mt-2">
                      <span className="font-semibold">API Key Configured:</span> {testResult.apiKeyConfigured ? 
                        <span className="text-green-600 font-medium">Yes</span> : 
                        <span className="text-red-600 font-medium">No</span>
                      }
                    </p>
                    {testResult.error && (
                      <p className="mt-2 text-red-600">
                        <span className="font-semibold">Error:</span> {testResult.error}
                      </p>
                    )}
                  </div>
                )}
              </CardFooter>
            )}
          </Card>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mt-8">
            <Card className="colorful-card bg-gradient-to-br from-purple-50 to-indigo-50">
              <CardHeader>
                <CardTitle className="text-indigo-700">GPT-4</CardTitle>
              </CardHeader>
              <CardContent>
                <p>Advanced reasoning capabilities perfect for complex tasks</p>
              </CardContent>
            </Card>
            
            <Card className="colorful-card bg-gradient-to-br from-blue-50 to-cyan-50">
              <CardHeader>
                <CardTitle className="text-cyan-700">Rev.ai</CardTitle>
              </CardHeader>
              <CardContent>
                <p>High-quality audio transcription for your media files</p>
              </CardContent>
            </Card>
            
            <Card className="colorful-card bg-gradient-to-br from-emerald-50 to-teal-50">
              <CardHeader>
                <CardTitle className="text-emerald-700">DALL·E</CardTitle>
              </CardHeader>
              <CardContent>
                <p>Generate stunning images from text descriptions</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
} 
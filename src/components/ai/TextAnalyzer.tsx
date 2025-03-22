'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export function TextAnalyzer() {
  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleSummarize = async () => {
    if (!text) return;
    
    setIsLoading(true);
    setSummary('');
    
    try {
      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Failed to summarize text');
      }

      const data = response.body;
      if (!data) return;

      const reader = data.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let summaryText = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value);
        summaryText += chunkValue;
        setSummary(summaryText);
      }
    } catch (error) {
      console.error('Error summarizing text:', error);
      setSummary('Error summarizing text. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSentimentAnalysis = async () => {
    if (!text) return;
    
    setIsLoading(true);
    setSentiment('');
    
    try {
      const response = await fetch('/api/ai/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze sentiment');
      }

      const data = response.body;
      if (!data) return;

      const reader = data.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let sentimentText = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value);
        sentimentText += chunkValue;
        setSentiment(sentimentText);
      }
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      setSentiment('Error analyzing sentiment. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Text Analysis</CardTitle>
          <CardDescription>
            Enter your text to analyze with AI
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Enter text to analyze..."
            value={text}
            onChange={handleTextChange}
            className="min-h-32"
          />
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button 
            onClick={handleSummarize} 
            disabled={!text || isLoading}
          >
            {isLoading ? 'Processing...' : 'Summarize'}
          </Button>
          <Button 
            onClick={handleSentimentAnalysis} 
            disabled={!text || isLoading}
            variant="outline"
          >
            {isLoading ? 'Processing...' : 'Analyze Sentiment'}
          </Button>
        </CardFooter>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{summary}</p>
          </CardContent>
        </Card>
      )}

      {sentiment && (
        <Card>
          <CardHeader>
            <CardTitle>Sentiment Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{sentiment}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 
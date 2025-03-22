'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function AudioTranscriber() {
  const [transcript, setTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
  };

  const handleFileUpload = async () => {
    if (!file) return;
    
    setIsLoading(true);
    setTranscript('');
    
    try {
      const formData = new FormData();
      formData.append('audio', file);
      
      const response = await fetch('/api/ai/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to transcribe audio');
      }

      const data = await response.json();
      setTranscript(data.transcript);
    } catch (error) {
      console.error('Error transcribing audio:', error);
      setTranscript('Error transcribing audio. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setTranscript('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Audio Transcription</CardTitle>
          <CardDescription>
            Upload an audio file to transcribe with OpenAI Whisper
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="max-w-sm"
            />
            {file && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={clearFile}
              >
                Clear
              </Button>
            )}
          </div>
          {file && (
            <p className="text-sm text-muted-foreground">
              Selected file: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleFileUpload} 
            disabled={!file || isLoading}
          >
            {isLoading ? 'Transcribing...' : 'Transcribe Audio'}
          </Button>
        </CardFooter>
      </Card>

      {transcript && (
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{transcript}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 
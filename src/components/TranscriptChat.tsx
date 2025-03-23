'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Avatar } from './ui/avatar';
import { Bot, Send, User, Loader2, ArrowDown, AlertCircle, Sparkles } from 'lucide-react';
import { TranscriptionRecord } from '@/lib/media-storage';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface TranscriptChatProps {
  transcriptionRecord: TranscriptionRecord | null;
}

export default function TranscriptChat({ transcriptionRecord }: TranscriptChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // Get the access token when the component mounts
  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setAccessToken(data.session.access_token);
      }
    };
    
    getSession();
  }, []);
  
  // Effect to scroll to bottom when new messages are added
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Track scroll position to show/hide scroll button
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const div = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = div;
    // Show button when scrolled up, hide when near bottom
    setShowScrollButton(scrollHeight - scrollTop - clientHeight > 100);
  };
  
  // Effect to initialize and cleanup event listeners
  useEffect(() => {
    // Get access token on mount
    const getToken = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setAccessToken(data.session.access_token);
      }
    };
    
    getToken();
  }, []);
  
  // Log transcription record when it changes
  useEffect(() => {
    if (transcriptionRecord) {
      console.log('TranscriptChat: Received transcription record:', {
        id: transcriptionRecord.id,
        fileName: transcriptionRecord.fileName,
        hasText: !!transcriptionRecord.transcriptionText,
      });
    }
  }, [transcriptionRecord]);
  
  // Initialize chat with a welcome message
  useEffect(() => {
    if (transcriptionRecord?.fileName) {
      const welcomeMessage: Message = {
        id: 'welcome',
        role: 'assistant',
        content: `Hello! I'm your AI assistant for analyzing the interview "${transcriptionRecord.fileName}". How can I help you understand this interview better? You can ask me about specific points in the transcript, summary highlights, sentiment analysis, or any other insights.`,
        timestamp: new Date(),
      };
      
      setMessages([welcomeMessage]);
      setError(null); // Clear any previous errors
    }
  }, [transcriptionRecord?.fileName, transcriptionRecord?.id]);
  
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };
  
  const handleSendMessage = async () => {
    if (!input.trim() || !transcriptionRecord?.id) return;
    
    // Log the transcription ID to help with debugging
    console.log('TranscriptChat: Sending message with transcriptionId:', 
      typeof transcriptionRecord.id === 'string' ? transcriptionRecord.id : String(transcriptionRecord.id),
      'Original type:', typeof transcriptionRecord.id
    );
    
    // Add user message to chat
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    
    try {
      // Get the latest access token
      const { data: sessionData } = await supabase.auth.getSession();
      const currentAccessToken = sessionData?.session?.access_token;
      
      if (!currentAccessToken) {
        throw new Error('Authentication required. Please log in again.');
      }
      
      // Always convert ID to string to ensure consistency
      const transcriptionIdString = typeof transcriptionRecord.id === 'string' 
        ? transcriptionRecord.id 
        : String(transcriptionRecord.id);
        
      console.log('TranscriptChat: Using normalized transcriptionId:', transcriptionIdString);
      
      // Send message to API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentAccessToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: input }],
          transcriptionId: transcriptionIdString,
          accessToken: currentAccessToken
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Chat API Error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error || 'Unknown error',
          transcriptionId: transcriptionIdString
        });
        
        // Set error state with the error message from the API
        setError(errorData.error || 'Failed to get response from assistant');
        
        // Create error message
        const assistantMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorData.error || response.statusText}. Please try again.`,
          timestamp: new Date(),
        };
        
        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      const data = await response.json();
      console.log('Received chat response:', data);
      
      // Add assistant response to chat
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.message.content,
        timestamp: new Date(),
      };
      
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error('Chat error:', error);
      // Add error message
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        timestamp: new Date(),
      };
      
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle Enter key press to send message
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  // Reset messages when transcription changes
  useEffect(() => {
    if (transcriptionRecord?.id) {
      setMessages([
        {
          id: '0',
          role: 'assistant',
          content: `Hello! I'm your AI assistant for analyzing the interview "${transcriptionRecord.fileName}". How can I help you understand this interview better? You can ask me about specific points in the transcript, summary highlights, sentiment analysis, or any other insights.`,
          timestamp: new Date(),
        },
      ]);
    } else {
      setMessages([]);
    }
  }, [transcriptionRecord?.id]);
  
  // If no transcription is available, don't render the chat
  if (!transcriptionRecord?.transcriptionText) {
    return null;
  }
  
  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-white rounded-lg border border-gray-200">
      <div className="flex items-center p-3 border-b">
        <Sparkles className="h-5 w-5 mr-2 text-blue-500" />
        <h3 className="text-lg font-medium">Interview Assistant</h3>
      </div>
      
      {error ? (
        <div className="flex-1 p-4 flex flex-col items-center justify-center text-center text-gray-500">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-red-500 font-medium mb-2">Error: {error}</p>
          <p className="mb-4">Unable to connect to the chat assistant.</p>
          <Button variant="outline" onClick={() => setError(null)}>Try Again</Button>
        </div>
      ) : (
        <>
          <div 
            id="chat-messages-container"
            className="flex-1 p-4 overflow-y-auto"
            onScroll={handleScroll}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <Avatar className="h-8 w-8 bg-blue-100">
                    <Bot className="h-5 w-5 text-blue-500" />
                  </Avatar>
                )}
                
                <div
                  className={`rounded-lg px-4 py-2 max-w-[80%] ${
                    message.role === 'user'
                      ? 'bg-primary text-white'
                      : 'bg-muted'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                  <p className="text-[10px] mt-1 opacity-70">
                    {message.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                
                {message.role === 'user' && (
                  <Avatar className="h-8 w-8 bg-primary/20">
                    <User className="h-5 w-5 text-primary" />
                  </Avatar>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex items-start gap-3">
                <Avatar className="h-8 w-8 bg-blue-100">
                  <Bot className="h-5 w-5 text-blue-500" />
                </Avatar>
                <div className="bg-muted rounded-lg px-4 py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          {showScrollButton && (
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-2 right-4 rounded-full shadow-md border border-blue-100"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </>
      )}
      
      <CardFooter className="border-t pt-4">
        <div className="flex w-full items-center space-x-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this interview..."
            className="min-h-[60px] resize-none"
            disabled={isLoading || !accessToken}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || !accessToken}
            className="h-10 w-10 p-0"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </CardFooter>
    </div>
  );
}

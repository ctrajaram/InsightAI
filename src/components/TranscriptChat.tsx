'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Avatar } from './ui/avatar';
import { Bot, Send, User, Loader2, ArrowDown, AlertCircle, Sparkles } from 'lucide-react';
import { TranscriptionRecord } from '@/lib/media-storage';
import { createClient } from '@supabase/supabase-js';
import { motion, AnimatePresence } from 'framer-motion';

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

export function TranscriptChat({ transcriptionRecord }: TranscriptChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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

  // Check if scroll button should be shown
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // Create user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      if (!transcriptionRecord?.transcriptionText) {
        throw new Error('No transcription available to analyze');
      }

      if (!accessToken) {
        throw new Error('Authentication required');
      }
      
      // Format messages for API - only include role and content as required by OpenAI
      const formattedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content || ''
      }));
      
      console.log('Sending chat request with transcription ID:', transcriptionRecord.id);
      console.log('Analysis data available:', {
        hasAnalysisData: !!transcriptionRecord.analysisData,
        analysisDataKeys: transcriptionRecord.analysisData ? Object.keys(transcriptionRecord.analysisData) : [],
        sentiment: transcriptionRecord.analysisData?.sentiment,
        hasPainPoints: Array.isArray(transcriptionRecord.analysisData?.pain_points),
        painPointsCount: Array.isArray(transcriptionRecord.analysisData?.pain_points) ? transcriptionRecord.analysisData.pain_points.length : 0,
        painPointsData: transcriptionRecord.analysisData?.pain_points ? JSON.stringify(transcriptionRecord.analysisData.pain_points).substring(0, 300) : 'null',
        painPointsType: typeof transcriptionRecord.analysisData?.pain_points,
      });

      const responseClone = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          messages: [...formattedMessages, {
            role: 'user', 
            content: input
          }],
          transcriptionId: transcriptionRecord.id,
          accessToken
        })
      });
      
      // Clone the response before attempting to read it
      const response = responseClone.clone();

      try {
        if (!response.ok) {
          const errorData = await response.json();
          console.error('API error details:', errorData);
          throw new Error(errorData.error || 'Failed to get response');
        }

        const data = await response.json();
        console.log('Received chat response:', data);

        const assistantMessage: Message = {
          id: Date.now().toString() + '-assistant',
          role: 'assistant',
          content: data.response || 'No response content received',
          timestamp: new Date()
        };

        setMessages(prev => [...prev, assistantMessage]);
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        try {
          // Try to read as text if JSON parsing fails
          const textResponse = await responseClone.text();
          console.error('Raw response text:', textResponse);
          setError('Failed to parse response from server');
        } catch (textError) {
          console.error('Error reading response as text:', textError);
          setError('Failed to read response from server');
        }
      } finally {
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Error in chat:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date);
  };

  const renderMessageContent = (content: string) => {
    // Check if content is undefined or null
    if (!content) {
      return <p>No content available</p>;
    }
    
    // Simple markdown-like formatting for message content
    return content
      .split('\n')
      .map((line, i) => <p key={i} className={i > 0 ? 'mt-2' : ''}>{line}</p>);
  };

  return (
    <div className="flex flex-col h-[500px] max-h-[500px] bg-white">
      {/* Messages container */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-gray-500">
            <Bot className="h-12 w-12 text-gray-400 mb-4" />
            <h3 className="font-medium text-gray-600 mb-2">Ask me about this interview</h3>
            <p className="text-sm max-w-xs">
              You can ask about specific details, request summaries of certain sections, or inquire about customer opinions.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`
                    flex items-start gap-3 max-w-[80%] sm:max-w-[70%] 
                    rounded-lg p-4 
                    ${message.role === 'user' 
                      ? 'bg-indigo-600 text-white ml-8' 
                      : 'bg-gray-100 text-gray-800 mr-8 border border-gray-200'
                    }
                  `}
                >
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0 mt-1">
                      <div className="bg-indigo-100 h-8 w-8 rounded-full flex items-center justify-center">
                        <Bot className="h-4 w-4 text-indigo-600" />
                      </div>
                    </div>
                  )}
                  
                  <div className="flex-1 overflow-hidden">
                    <div className="prose max-w-none overflow-hidden break-words">
                      {renderMessageContent(message.content)}
                    </div>
                    <div className={`text-xs mt-2 ${message.role === 'user' ? 'text-indigo-200' : 'text-gray-500'}`}>
                      {formatTimestamp(message.timestamp)}
                    </div>
                  </div>
                  
                  {message.role === 'user' && (
                    <div className="flex-shrink-0 mt-1">
                      <div className="bg-indigo-700 h-8 w-8 rounded-full flex items-center justify-center">
                        <User className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            <div ref={messagesEndRef} />
          </AnimatePresence>
        )}
        
        {/* Loading indicator */}
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-3 max-w-[70%] bg-gray-100 rounded-lg p-4 text-gray-800 border border-gray-200"
          >
            <div className="flex-shrink-0">
              <div className="bg-indigo-100 h-8 w-8 rounded-full flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-indigo-600 animate-spin" />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse"></div>
              <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </motion.div>
        )}
        
        {/* Error message */}
        {error && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200"
          >
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p>{error}</p>
          </motion.div>
        )}
      </div>
      
      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-20 right-6 bg-indigo-500 text-white rounded-full p-2 shadow-md hover:bg-indigo-600 transition-colors"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
      
      {/* Input form */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about the interview..."
              className="min-h-[50px] max-h-[160px] py-3 pr-10 resize-none border-gray-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white rounded-lg"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            {input.trim().length > 0 && (
              <div className="absolute right-3 bottom-3 text-xs text-gray-400">
                Press Enter to send
              </div>
            )}
          </div>
          <Button 
            type="submit" 
            disabled={!input.trim() || isLoading}
            className="h-auto self-end bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            <Send className="h-5 w-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          <Sparkles className="h-3 w-3 inline-block mr-1" />
          AI responses are generated based on the transcript content
        </p>
      </div>
    </div>
  );
}

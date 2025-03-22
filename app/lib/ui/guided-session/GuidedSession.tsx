'use client';

import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useTranscription } from './useTranscription';
import ChatComponent from './ChatComponent';
import MicrophoneButton from './MicrophoneButton';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

export interface GuidedSessionProps {
  sessionId?: string;
  className?: string;
}

export default function GuidedSession({ 
  sessionId = 'default-session', 
  className = '' 
}: GuidedSessionProps) {
  console.log('[GuidedSession] Initializing with sessionId:', sessionId);
  
  const [messages, setMessages] = useState<Message[]>([]);
  
  useEffect(() => {
    console.log('[GuidedSession] Messages updated:', messages.length);
  }, [messages]);
  
  const handleTranscriptionUpdate = useCallback((text: string, isFinal: boolean) => {
    console.log('[GuidedSession:handleTranscriptionUpdate] Text received, isFinal:', isFinal, 'text length:', text.length);
    
    if (isFinal && text.trim()) {
      console.log('[GuidedSession:handleTranscriptionUpdate] Adding final message');
      // Add the final transcription as a user message
      setMessages((prevMessages) => {
        const newMessage: Message = {
          id: uuidv4(),
          content: text.trim(),
          sender: 'user',
          timestamp: new Date(),
        };
        console.log('[GuidedSession:handleTranscriptionUpdate] New message:', newMessage);
        return [...prevMessages, newMessage];
      });
    }
  }, []);

  const {
    status,
    transcript,
    partialTranscript,
    isConnected,
    startTranscription,
    stopTranscription,
    error,
  } = useTranscription({
    onTranscriptionUpdate: handleTranscriptionUpdate,
  });

  // Log transcription state changes
  useEffect(() => {
    console.log('[GuidedSession] Transcription status:', status);
  }, [status]);

  useEffect(() => {
    console.log('[GuidedSession] Transcription error:', error?.message);
  }, [error]);

  useEffect(() => {
    console.log('[GuidedSession] Partial transcript updated, length:', partialTranscript.length);
  }, [partialTranscript]);

  useEffect(() => {
    console.log('[GuidedSession] Full transcript updated, length:', transcript.length);
  }, [transcript]);

  const handleToggleMicrophone = useCallback(() => {
    console.log('[GuidedSession:handleToggleMicrophone] Toggle microphone, current state:', isConnected);
    
    if (isConnected) {
      console.log('[GuidedSession:handleToggleMicrophone] Stopping transcription');
      stopTranscription();
    } else {
      console.log('[GuidedSession:handleToggleMicrophone] Starting transcription');
      startTranscription();
    }
  }, [isConnected, startTranscription, stopTranscription]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex-1 relative">
        <ChatComponent
          messages={messages}
          currentUserMessage={partialTranscript}
          className="h-full"
        />
      </div>
      
      <div className="flex items-center justify-center p-4 border-t border-gray-200 dark:border-gray-700">
        {error && (
          <div className="text-red-500 text-sm mr-4">
            Error: {error.message}
          </div>
        )}
        
        <MicrophoneButton
          isConnected={isConnected}
          isConnecting={status === 'connecting'}
          onToggle={handleToggleMicrophone}
        />
        
        <div className="ml-4 text-sm text-gray-500 dark:text-gray-400">
          {status === 'idle' && 'Click the microphone to start speaking'}
          {status === 'connecting' && 'Connecting...'}
          {status === 'transcribing' && 'Listening...'}
          {status === 'disconnected' && 'Disconnected'}
        </div>
      </div>
    </div>
  );
} 
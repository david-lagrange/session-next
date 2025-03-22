'use client';

import { useEffect, useRef } from 'react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface ChatComponentProps {
  messages: Message[];
  currentUserMessage: string;
  className?: string;
}

export default function ChatComponent({
  messages,
  currentUserMessage,
  className = '',
}: ChatComponentProps) {
  console.log('[ChatComponent] Rendering with', messages.length, 'messages, currentUserMessage length:', currentUserMessage?.length || 0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    console.log('[ChatComponent:useEffect] Scrolling to bottom, messages:', messages.length, 'currentUserMessage length:', currentUserMessage?.length || 0);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentUserMessage]);

  return (
    <div className={`flex flex-col h-full overflow-hidden ${className}`}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          console.log('[ChatComponent] Rendering message:', message.id, 'from:', message.sender);
          return (
            <div
              key={message.id}
              className={`flex ${
                message.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.sender === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 dark:text-gray-100'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <div
                  className={`text-xs mt-1 ${
                    message.sender === 'user'
                      ? 'text-blue-200'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          );
        })}
        
        {/* Current user message being transcribed */}
        {currentUserMessage && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-lg p-3 bg-blue-500 text-white">
              <p className="whitespace-pre-wrap break-words">{currentUserMessage}</p>
              <div className="flex items-center mt-1 text-blue-200 text-xs">
                <span className="mr-2">Transcribing</span>
                <span className="flex">
                  <span className="animate-pulse">.</span>
                  <span className="animate-pulse delay-150">.</span>
                  <span className="animate-pulse delay-300">.</span>
                </span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
} 
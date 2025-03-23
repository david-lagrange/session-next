"use client";

import { useState, useEffect, useRef } from "react";

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatComponentProps {
  transcription: string;
  messages?: Message[];
}

export default function ChatComponent({ transcription, messages = [] }: ChatComponentProps) {
  console.log(`🟡 [ChatComponent] Rendering with transcription length: ${transcription.length}`);
  
  useEffect(() => {
    if (transcription) {
      console.log(`🟡 [ChatComponent] Transcription updated: "${transcription.slice(-30)}"`);
    }
  }, [transcription]);
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Show past messages with timestamps */}
        {messages.map((message, index) => (
          <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-3 rounded-lg max-w-[80%] ${
              message.role === 'user' 
                ? 'bg-blue-100 dark:bg-blue-900 text-gray-800 dark:text-gray-200' 
                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}>
              <p>{message.content}</p>
              <p className="text-xs text-gray-500 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        
        {/* Show current transcription */}
        {transcription && (
          <div className="flex">
            <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-lg max-w-[80%]">
              <p className="text-gray-800 dark:text-gray-200">{transcription}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 
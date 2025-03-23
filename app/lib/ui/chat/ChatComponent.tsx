"use client";

import { useState, useEffect, useRef } from "react";

interface ChatComponentProps {
  transcription: string;
}

export default function ChatComponent({ transcription }: ChatComponentProps) {
  console.log(`🟡 [ChatComponent] Rendering with transcription length: ${transcription.length}`);
  
  useEffect(() => {
    if (transcription) {
      console.log(`🟡 [ChatComponent] Transcription updated: "${transcription.slice(-30)}"`);
    }
  }, [transcription]);
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
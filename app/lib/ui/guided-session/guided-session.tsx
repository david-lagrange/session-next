"use client";

import { useState, useEffect } from "react";
import ChatComponent, { Message } from "@/app/lib/ui/chat/chat-component";
import { AudioCaptureService } from "@/app/lib/services/audio-capture";
import { TranscriptionService, TranscriptionStatus } from "@/app/lib/services/transcription";

export default function GuidedSession() {
  const [transcription, setTranscription] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [allUserMessages, setAllUserMessages] = useState<Message[]>([]); // Store all user messages for LLM call
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioCapture, setAudioCapture] = useState<AudioCaptureService | null>(null);
  const [transcriptionService, setTranscriptionService] = useState<TranscriptionService | null>(null);
  
  // Initialize services
  useEffect(() => {
    // Create the transcription service
    const newTranscriptionService = new TranscriptionService({
      onTranscriptionUpdate: (text) => {
        setTranscription((prev) => prev + text);
      },
      onTranscriptionCompleted: (fullTranscript) => {
        // Add completed transcription as a new message with timestamp
        if (fullTranscript && fullTranscript.trim()) {
          const newMessage = { 
            role: 'user' as const, 
            content: fullTranscript.trim(),
            timestamp: new Date()
          };
          
          setMessages(prev => [...prev, newMessage]);
          setAllUserMessages(prev => [...prev, newMessage]); // Store for LLM call
          setTranscription(""); // Clear the transcription for the next speech segment
        }
      },
      onError: (message) => {
        setError(message);
        stopSession();
      },
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        // When transcription service is active, start audio capture
        if (newStatus === 'active' && !audioCapture) {
          startAudioCapture(newTranscriptionService);
        }
      }
    });
    
    setTranscriptionService(newTranscriptionService);
    
    // Cleanup on unmount
    return () => {
      stopSession();
    };
  }, []);
  
  // Start capturing audio and sending to transcription service
  const startAudioCapture = (transService: TranscriptionService) => {
    const newAudioCapture = new AudioCaptureService({
      onAudioData: (audioData) => {
        transService.sendAudio(audioData);
      }
    });
    
    newAudioCapture.start()
      .then(() => {
        setAudioCapture(newAudioCapture);
      })
      .catch((err) => {
        setError(err.message || "Failed to start audio capture");
        stopSession();
      });
  };
  
  // Start the guided session
  const startSession = async () => {
    console.log("🔷 [GuidedSession] Starting guided session");
    setTranscription("");
    // Don't clear messages when starting a new session
    setError(null);
    
    if (transcriptionService) {
      await transcriptionService.start();
    }
  };
  
  // Stop the guided session
  const stopSession = () => {
    console.log("🔷 [GuidedSession] Stopping guided session");
    
    if (audioCapture) {
      audioCapture.stop();
      setAudioCapture(null);
    }
    
    if (transcriptionService) {
      transcriptionService.stop();
    }
  };
  
  const isLoading = status === 'connecting';
  const isSessionActive = status === 'active';
  
  // Optional: Add a function to get all user messages for LLM call
  const getUserMessagesForLLM = () => {
    return allUserMessages.map(msg => msg.content);
  };

  const resetSession = () => {
    setMessages([]);
    setTranscription("");
    // Optionally, keep allUserMessages if you need the history for the LLM
    // or clear it if you want to start fresh:
    // setAllUserMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 flex flex-col items-center">
        <div className="flex mb-2">
          <button
            onClick={startSession}
            disabled={isSessionActive || isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md mr-2 disabled:bg-gray-400"
          >
            {isLoading ? "Connecting..." : "Start Session"}
          </button>
          <button
            onClick={stopSession}
            disabled={!isSessionActive || isLoading}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md disabled:bg-gray-400"
          >
            End Session
          </button>
          <button
            onClick={resetSession}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md ml-2"
          >
            Reset Chat
          </button>
        </div>
        
        {error && (
          <div className="text-red-500 text-sm mb-2 max-w-md text-center">
            {error}
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-hidden">
        <ChatComponent 
          transcription={transcription} 
          messages={messages}
        />
      </div>
    </div>
  );
} 
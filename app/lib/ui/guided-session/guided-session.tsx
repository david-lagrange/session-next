"use client";

import { useState, useEffect, useRef } from "react";
import { createTranscriptionSession } from "@/app/lib/actions/transcription/create-session";
import ChatComponent from "@/app/lib/ui/chat/chat-component";

export default function GuidedSession() {
  const [transcription, setTranscription] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Set up WebSocket connection when transcription starts
  useEffect(() => {
    if (!isTranscribing) return;

    const setupWebSocket = async () => {
      try {
        setIsLoading(true);
        setError(null);
        console.log("🔷 [GuidedSession] Fetching client secret from server action...");
        
        const { clientSecret } = await createTranscriptionSession();
        console.log(`🔷 [GuidedSession] Received client secret, length: ${clientSecret.length}`);
        
        console.log("🔷 [GuidedSession] Creating WebSocket connection...");
        // Fixed WebSocket URL and added authentication via subprotocols
        const ws = new WebSocket(
          "wss://api.openai.com/v1/realtime?intent=transcription",
          [
            "realtime",
            `openai-insecure-api-key.${clientSecret}`,
            "openai-beta.realtime-v1"
          ]
        );
        
        ws.onopen = () => {
          console.log("🟢 [GuidedSession] WebSocket connection opened");
          setIsLoading(false);
          startAudioCapture();
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log("🟢 [GuidedSession] Received message:", JSON.stringify(message).substring(0, 200));
            handleWebSocketMessage(message);
          } catch (err) {
            console.error("🔴 [GuidedSession] Error parsing message:", err, event.data);
          }
        };

        ws.onclose = (event) => {
          console.log(`🟠 [GuidedSession] WebSocket closed with code ${event.code}: ${event.reason}`);
          setIsLoading(false);
          if (isTranscribing) {
            setError(`Connection closed: ${event.reason || "Unknown reason"}`);
            setIsTranscribing(false);
          }
          cleanup();
        };

        ws.onerror = (error) => {
          console.error("🔴 [GuidedSession] WebSocket error:", error);
          setIsLoading(false);
          setError("WebSocket connection error");
          setIsTranscribing(false);
          cleanup();
        };

        wsRef.current = ws;
      } catch (error: any) {
        console.error("🔴 [GuidedSession] Error setting up WebSocket:", error);
        setIsLoading(false);
        setIsTranscribing(false);
        setError(`Error: ${error.message || "Unknown error"}`);
      }
    };

    setupWebSocket();

    return () => {
      console.log("🟠 [GuidedSession] Cleanup on unmount/dependency change");
      cleanup();
    };
  }, [isTranscribing]);

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = (message: any) => {
    if (message.type === "error") {
      console.error("🔴 [GuidedSession] Error from WebSocket:", message.error);
      setError(`API Error: ${message.error.message || "Unknown error"}`);
      return;
    }
    
    switch (message.type) {
      case "conversation.item.input_audio_transcription.delta":
        console.log(`🟢 [GuidedSession] Transcription delta: "${message.delta}"`);
        setTranscription((prev) => prev + message.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        console.log(`🟢 [GuidedSession] Transcription completed: "${message.transcript}"`);
        setTranscription((prev) => prev + " ");
        break;
      case "input_audio_buffer.speech_started":
        console.log("🟢 [GuidedSession] Speech started");
        break;
      case "input_audio_buffer.speech_stopped":
        console.log("🟢 [GuidedSession] Speech stopped");
        break;
      default:
        console.log(`🟠 [GuidedSession] Unhandled event type: ${message.type}`);
    }
  };

  // Start audio capture once WebSocket is connected
  const startAudioCapture = async () => {
    try {
      console.log("🔷 [GuidedSession] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("🟢 [GuidedSession] Microphone access granted");

      console.log("🔷 [GuidedSession] Creating audio context (24kHz)...");
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      console.log("🔷 [GuidedSession] Setting up audio processor...");
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let packetCount = 0;
      processor.onaudioprocess = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16Data = convertToPCM16(inputData);
          
          packetCount++;
          if (packetCount % 10 === 0) {
            console.log(`🟢 [GuidedSession] Sending audio packet #${packetCount} (${pcm16Data.byteLength} bytes)`);
          }
          
          wsRef.current.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: arrayBufferToBase64(pcm16Data),
            })
          );
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      console.log("🟢 [GuidedSession] Audio capture started");
    } catch (error) {
      console.error("🔴 [GuidedSession] Error starting audio capture:", error);
      setError("Could not access microphone");
      cleanup();
    }
  };

  // Convert float audio data to PCM16
  const convertToPCM16 = (floatArray: Float32Array) => {
    const buffer = new ArrayBuffer(floatArray.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < floatArray.length; i++) {
      const s = Math.max(-1, Math.min(1, floatArray[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  };

  // Convert ArrayBuffer to Base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Start transcription
  const startTranscription = () => {
    console.log("🔷 [GuidedSession] Starting transcription session");
    setTranscription("");
    setError(null);
    setIsTranscribing(true);
  };

  // Stop transcription and cleanup
  const stopTranscription = () => {
    console.log("🔷 [GuidedSession] Stopping transcription session");
    setIsTranscribing(false);
    cleanup();
  };

  // Cleanup resources
  const cleanup = () => {
    console.log("🔷 [GuidedSession] Running cleanup");
    
    if (wsRef.current) {
      console.log("🔷 [GuidedSession] Closing WebSocket connection");
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (processorRef.current && sourceRef.current && audioContextRef.current) {
      console.log("🔷 [GuidedSession] Disconnecting audio nodes");
      sourceRef.current.disconnect(processorRef.current);
      processorRef.current.disconnect(audioContextRef.current.destination);
    }
    
    if (streamRef.current) {
      console.log("🔷 [GuidedSession] Stopping audio tracks");
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      console.log("🔷 [GuidedSession] Closing audio context");
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    console.log("🟢 [GuidedSession] Cleanup completed");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 flex flex-col items-center">
        <div className="flex mb-2">
          <button
            onClick={startTranscription}
            disabled={isTranscribing || isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md mr-2 disabled:bg-gray-400"
          >
            {isLoading ? "Connecting..." : "Start Session"}
          </button>
          <button
            onClick={stopTranscription}
            disabled={!isTranscribing || isLoading}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md disabled:bg-gray-400"
          >
            End Session
          </button>
        </div>
        
        {error && (
          <div className="text-red-500 text-sm mb-2 max-w-md text-center">
            {error}
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-hidden">
        <ChatComponent transcription={transcription} />
      </div>
    </div>
  );
} 
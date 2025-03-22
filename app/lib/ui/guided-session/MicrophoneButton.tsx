'use client';

import { useState, useEffect } from 'react';
import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import { ImSpinner8 } from 'react-icons/im';

interface MicrophoneButtonProps {
  isConnected: boolean;
  isConnecting: boolean;
  onToggle: () => void;
  className?: string;
}

export default function MicrophoneButton({
  isConnected,
  isConnecting,
  onToggle,
  className = '',
}: MicrophoneButtonProps) {
  console.log('[MicrophoneButton] Rendering with state:', { isConnected, isConnecting });
  
  useEffect(() => {
    console.log('[MicrophoneButton:useEffect] Connection status changed:', { isConnected, isConnecting });
  }, [isConnected, isConnecting]);
  
  const handleClick = () => {
    console.log('[MicrophoneButton:handleClick] Button clicked, current state:', { isConnected, isConnecting });
    onToggle();
  };
  
  return (
    <button
      onClick={handleClick}
      className={`flex items-center justify-center w-12 h-12 rounded-full transition-colors ${
        isConnected
          ? 'bg-red-500 hover:bg-red-600'
          : 'bg-blue-500 hover:bg-blue-600'
      } text-white ${className}`}
      disabled={isConnecting}
      aria-label={isConnected ? 'Stop recording' : 'Start recording'}
      title={isConnected ? 'Stop recording' : 'Start recording'}
    >
      {isConnecting ? (
        <ImSpinner8 className="animate-spin w-5 h-5" />
      ) : isConnected ? (
        <FaMicrophoneSlash className="w-5 h-5" />
      ) : (
        <FaMicrophone className="w-5 h-5" />
      )}
    </button>
  );
} 
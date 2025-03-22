'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getEphemeralKey } from '@/app/lib/actions/transcription/transcription-actions';

type TranscriptionStatus = 'idle' | 'connecting' | 'transcribing' | 'error' | 'disconnected';

type TranscriptionEvent = {
  type: string;
  event_id?: string;
  item_id?: string;
  content_index?: number;
  delta?: string;
  transcript?: string;
};

export interface UseTranscriptionProps {
  onTranscriptionUpdate?: (text: string, isFinal: boolean) => void;
  autoConnect?: boolean;
}

export interface UseTranscriptionReturn {
  status: TranscriptionStatus;
  transcript: string;
  partialTranscript: string;
  isConnected: boolean;
  startTranscription: () => Promise<void>;
  stopTranscription: () => void;
  error: Error | null;
}

export function useTranscription({
  onTranscriptionUpdate,
  autoConnect = false,
}: UseTranscriptionProps = {}): UseTranscriptionReturn {
  console.log('[useTranscription] Initializing hook with autoConnect:', autoConnect);
  
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [partialTranscript, setPartialTranscript] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const handleTranscriptionEvent = useCallback(
    (event: TranscriptionEvent) => {
      console.log('[useTranscription:handleTranscriptionEvent] Received event:', event.type);
      
      if (event.type === 'conversation.item.input_audio_transcription.delta' && event.delta) {
        console.log('[useTranscription:handleTranscriptionEvent] Received delta:', event.delta);
        setPartialTranscript((prev) => {
          const updatedTranscript = prev + event.delta!;
          onTranscriptionUpdate?.(updatedTranscript, false);
          return updatedTranscript;
        });
      } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
        console.log('[useTranscription:handleTranscriptionEvent] Received completed transcript:', event.transcript);
        // Save the full transcript and reset the partial transcript
        setTranscript((prev) => {
          const newTranscript = prev ? `${prev} ${event.transcript}` : event.transcript || '';
          onTranscriptionUpdate?.(newTranscript, true);
          return newTranscript;
        });
        setPartialTranscript('');
      } else {
        console.log('[useTranscription:handleTranscriptionEvent] Unhandled event type:', event);
      }
    },
    [onTranscriptionUpdate]
  );

  const setupTranscription = useCallback(async () => {
    console.log('[useTranscription:setupTranscription] Setting up transcription');
    try {
      setStatus('connecting');
      console.log('[useTranscription:setupTranscription] Status set to connecting');
      setError(null);

      // Get ephemeral key from server
      console.log('[useTranscription:setupTranscription] Requesting ephemeral key');
      const ephemeralKey = await getEphemeralKey();
      if (!ephemeralKey) {
        console.error('[useTranscription:setupTranscription] Failed to get ephemeral key - key is empty');
        throw new Error('Failed to get ephemeral key');
      }
      console.log('[useTranscription:setupTranscription] Successfully received ephemeral key');

      // Request access to microphone
      console.log('[useTranscription:setupTranscription] Requesting microphone access');
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = mediaStream;
      console.log('[useTranscription:setupTranscription] Microphone access granted');

      // Create a peer connection with STUN and TURN servers for better NAT traversal
      console.log('[useTranscription:setupTranscription] Creating RTCPeerConnection with TURN servers');
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          // STUN servers - help discover public IP address
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          
          // TURN servers - relay traffic when direct connection fails
          // Note: In production, replace these with your actual TURN servers
          // Free TURN server examples (limited capacity, not for production use)
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
          
          // For production, use a dedicated TURN service like Twilio, Xirsys, or your own:
          // { 
          //   urls: "turn:your-turn-server.com:3478",
          //   username: "your-username", 
          //   credential: "your-password"
          // }
        ],
        iceCandidatePoolSize: 10 // Increase candidate pool size
      });
      peerConnectionRef.current = peerConnection;

      // Add the audio track from the microphone to the peer connection
      console.log('[useTranscription:setupTranscription] Adding audio tracks');
      mediaStream.getAudioTracks().forEach((track) => {
        console.log('[useTranscription:setupTranscription] Adding track:', track.label);
        peerConnection.addTrack(track, mediaStream);
      });

      // Create a data channel for sending and receiving events
      console.log('[useTranscription:setupTranscription] Creating data channel');
      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      // Set up data channel event handlers
      dataChannel.onopen = () => {
        console.log('[useTranscription:dataChannel] Data channel opened');
        setStatus('transcribing');
      };

      dataChannel.onmessage = (event) => {
        try {
          console.log('[useTranscription:dataChannel] Received message');
          const data = JSON.parse(event.data);
          handleTranscriptionEvent(data);
        } catch (e) {
          console.error('[useTranscription:dataChannel] Error parsing data channel message:', e);
        }
      };

      dataChannel.onclose = () => {
        console.log('[useTranscription:dataChannel] Data channel closed');
        setStatus('disconnected');
      };

      dataChannel.onerror = (e) => {
        console.error('[useTranscription:dataChannel] Data channel error:', e);
        setError(new Error('Data channel error'));
        setStatus('error');
      };

      // Log ICE candidate gathering
      const gatheredCandidates = [];
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          gatheredCandidates.push(event.candidate);
          console.log('[useTranscription:peerConnection] ICE candidate gathered:', JSON.stringify(event.candidate));
        } else {
          console.log('[useTranscription:peerConnection] ICE candidate gathering complete, total candidates:', gatheredCandidates.length);
        }
      };

      // Enhanced ICE connection state logging
      peerConnection.oniceconnectionstatechange = () => {
        console.log('[useTranscription:peerConnection] ICE connection state changed:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'closed') {
          console.log('[useTranscription:peerConnection] Connection ended, setting status to disconnected');
          setStatus('disconnected');
        } else if (peerConnection.iceConnectionState === 'connected' || 
                  peerConnection.iceConnectionState === 'completed') {
          console.log('[useTranscription:peerConnection] Connection established');
          setStatus('transcribing');
        }
      };

      peerConnection.onicecandidateerror = (e) => {
        console.error('[useTranscription:peerConnection] ICE candidate error:', e);
      };

      // Add log for ice gathering state changes
      peerConnection.onicegatheringstatechange = () => {
        console.log('[useTranscription:peerConnection] ICE gathering state changed:', peerConnection.iceGatheringState);
      };

      // Create an offer for the WebRTC connection
      console.log('[useTranscription:setupTranscription] Creating offer');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      console.log('[useTranscription:setupTranscription] Local description set');
      
      // Wait for ICE gathering to complete before sending the offer
      console.log('[useTranscription:setupTranscription] Waiting for ICE gathering to complete...');
      await new Promise<void>((resolve) => {
        if (peerConnection.iceGatheringState === 'complete') {
          console.log('[useTranscription:setupTranscription] ICE gathering already complete');
          resolve();
        } else {
          console.log('[useTranscription:setupTranscription] ICE gathering in progress:', peerConnection.iceGatheringState);
          
          // Set a timeout to prevent indefinite waiting
          const timeoutId = setTimeout(() => {
            console.log('[useTranscription:setupTranscription] ICE gathering timeout after 5 seconds, proceeding anyway');
            resolve();
          }, 5000);
          
          peerConnection.addEventListener('icegatheringstatechange', () => {
            if (peerConnection.iceGatheringState === 'complete') {
              console.log('[useTranscription:setupTranscription] ICE gathering complete event received');
              clearTimeout(timeoutId);
              resolve();
            }
          });
        }
      });
      
      console.log('[useTranscription:setupTranscription] ICE gathering complete, gathered candidates:', gatheredCandidates.length);

      // Get the complete SDP with all gathered candidates
      const completeSdp = peerConnection.localDescription?.sdp;
      if (!completeSdp) {
        throw new Error('No local description available after ICE gathering');
      }
      
      // Log the first 300 and last 300 characters of the SDP for debugging
      console.log('[useTranscription:setupTranscription] Complete SDP Offer (beginning):', 
        completeSdp.substring(0, 300) + '...');
      console.log('[useTranscription:setupTranscription] Complete SDP Offer (end):', 
        '...' + completeSdp.substring(completeSdp.length - 300));
      console.log('[useTranscription:setupTranscription] SDP Offer contains candidates:', completeSdp.includes('a=candidate:'));

      // Connect to the OpenAI Realtime API with the ephemeral key
      console.log('[useTranscription:setupTranscription] Connecting to OpenAI Realtime API with intent=transcription');
      const response = await fetch(
        'https://api.openai.com/v1/realtime?intent=transcription',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
            'OpenAI-Beta': 'realtime=v1'
          },
          body: completeSdp, // Using the complete SDP with all ICE candidates
        }
      );

      console.log('[useTranscription:setupTranscription] API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[useTranscription:setupTranscription] API Error Response:', errorText);
        throw new Error(`Failed to connect to OpenAI Realtime API: ${response.status} - ${errorText}`);
      }

      const answerSdp = await response.text();
      console.log('[useTranscription:setupTranscription] Received SDP answer');
      console.log('[useTranscription:setupTranscription] SDP Answer (beginning):', 
        answerSdp.substring(0, 300) + '...');
      console.log('[useTranscription:setupTranscription] SDP Answer (end):', 
        '...' + answerSdp.substring(answerSdp.length - 300));
      console.log('[useTranscription:setupTranscription] SDP Answer contains candidates:', answerSdp.includes('a=candidate:'));
      
      const answer = { type: 'answer', sdp: answerSdp } as RTCSessionDescriptionInit;
      await peerConnection.setRemoteDescription(answer);
      console.log('[useTranscription:setupTranscription] Remote description set');

      console.log('[useTranscription:setupTranscription] Setup complete, waiting for connection to establish');
      
      // Return success to indicate setup was completed
      return true;
    } catch (err) {
      console.error('[useTranscription:setupTranscription] Error during setup:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus('error');
      // Clean up any resources
      stopTranscription();
      // Return false to indicate setup failed
      return false;
    }
  }, [handleTranscriptionEvent]);

  const startTranscription = useCallback(async () => {
    console.log('[useTranscription:startTranscription] Starting transcription with retry logic');
    
    let retries = 3;
    while (retries > 0) {
      try {
        const success = await setupTranscription();
        if (success) {
          console.log('[useTranscription:startTranscription] Setup successful');
          break; // Exit retry loop if successful
        } else {
          throw new Error('Setup failed');
        }
      } catch (err) {
        retries--;
        console.error(`[useTranscription:startTranscription] Setup failed. Retries left: ${retries}`);
        
        if (retries === 0) {
          console.error('[useTranscription:startTranscription] All retry attempts failed');
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
          stopTranscription();
          return;
        }
        
        // Wait before retrying
        console.log('[useTranscription:startTranscription] Waiting 2 seconds before retry');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }, [setupTranscription]);

  const stopTranscription = useCallback(() => {
    console.log('[useTranscription:stopTranscription] Stopping transcription');
    
    // Stop all tracks in the media stream
    if (mediaStreamRef.current) {
      console.log('[useTranscription:stopTranscription] Stopping media tracks');
      mediaStreamRef.current.getTracks().forEach((track) => {
        console.log('[useTranscription:stopTranscription] Stopping track:', track.label);
        track.stop();
      });
      mediaStreamRef.current = null;
    }

    // Close the data channel
    if (dataChannelRef.current) {
      console.log('[useTranscription:stopTranscription] Closing data channel');
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Close the peer connection
    if (peerConnectionRef.current) {
      console.log('[useTranscription:stopTranscription] Closing peer connection');
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Update state
    console.log('[useTranscription:stopTranscription] Setting status to idle');
    setStatus('idle');
  }, []);

  // Auto-connect if specified
  useEffect(() => {
    console.log('[useTranscription:useEffect] Status:', status, 'AutoConnect:', autoConnect);
    if (autoConnect && status === 'idle') {
      console.log('[useTranscription:useEffect] Auto-connecting');
      startTranscription();
    }

    // Clean up when component unmounts
    return () => {
      console.log('[useTranscription:useEffect] Cleanup on unmount');
      stopTranscription();
    };
  }, [autoConnect, status, startTranscription, stopTranscription]);

  // Log status changes
  useEffect(() => {
    console.log('[useTranscription:statusChange] Status changed to:', status);
  }, [status]);

  const isConnected = status === 'transcribing';

  return {
    status,
    transcript,
    partialTranscript,
    isConnected,
    startTranscription,
    stopTranscription,
    error,
  };
} 
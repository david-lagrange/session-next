'use client';

import { useEffect, useRef, useState } from 'react';
import { getEphemeralKey } from '../../actions/realtime-api/ephemeral-key';

// Logger utility
const Logger = {
  info: (component: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] [${component}] ${message}`, data || '');
  },
  warn: (component: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] [${component}] ${message}`, data || '');
  },
  error: (component: string, message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] [${component}] ${message}`, error || '');
  },
  debug: (component: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.debug(`[${timestamp}] [DEBUG] [${component}] ${message}`, data || '');
  }
};

// Types for transcription events
type TranscriptionDelta = {
  event_id: string;
  type: 'conversation.item.input_audio_transcription.delta';
  item_id: string;
  content_index: number;
  delta: string;
};

type TranscriptionCompleted = {
  event_id: string;
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  content_index: number;
  transcript: string;
};

type TranscriptionSpeechStarted = {
  event_id: string;
  type: 'input_audio_buffer.speech_started';
  item_id: string;
};

type TranscriptionSpeechStopped = {
  event_id: string;
  type: 'input_audio_buffer.speech_stopped';
  item_id: string;
};

type TranscriptionEvent = 
  | TranscriptionDelta
  | TranscriptionCompleted
  | TranscriptionSpeechStarted
  | TranscriptionSpeechStopped;

// Main GuidedSession component
export default function GuidedSession() {
  // Refs for WebRTC connection and media streaming
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add a ref to track connection recovery attempts
  const recoveryAttemptsRef = useRef<number>(0);
  const maxRecoveryAttempts = 3;
  
  // Add a ref to store the ephemeral key for ICE restarts
  const ephemeralKeyRef = useRef<string | null>(null);
  
  // State for connection and transcription
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Clean up resources on component unmount
  useEffect(() => {
    Logger.info('GuidedSession', 'Component mounted');
    
    return () => {
      Logger.info('GuidedSession', 'Component unmounting, cleaning up resources');
      
      if (heartbeatIntervalRef.current) {
        Logger.debug('GuidedSession', 'Clearing heartbeat interval');
        clearInterval(heartbeatIntervalRef.current);
      }
      
      if (dataChannelRef.current) {
        Logger.debug('GuidedSession', 'Closing data channel');
        dataChannelRef.current.close();
      }
      
      if (peerConnectionRef.current) {
        Logger.debug('GuidedSession', 'Closing peer connection');
        peerConnectionRef.current.close();
      }
      
      if (mediaStreamRef.current) {
        Logger.debug('GuidedSession', 'Stopping media tracks');
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      Logger.info('GuidedSession', 'Resources cleaned up');
    };
  }, []);

  // Add a function to attempt connection recovery
  const attemptConnectionRecovery = async () => {
    if (recoveryAttemptsRef.current >= maxRecoveryAttempts) {
      Logger.error('GuidedSession', 'Maximum recovery attempts reached, giving up', {
        attempts: recoveryAttemptsRef.current,
        max: maxRecoveryAttempts
      });
      setError('Connection failed after multiple recovery attempts. Please try again later.');
      cleanupConnection();
      return;
    }

    recoveryAttemptsRef.current++;
    Logger.info('GuidedSession', 'Attempting connection recovery', {
      attempt: recoveryAttemptsRef.current,
      max: maxRecoveryAttempts
    });

    // Clean up the current connection
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // Keep the media stream if it's still valid
    if (mediaStreamRef.current && !mediaStreamRef.current.getAudioTracks()[0]?.enabled) {
      Logger.debug('GuidedSession', 'Refreshing audio stream for recovery');
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Wait a moment before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reinitialize the connection
    initializeConnection();
  };

  // Add this function to get ICE servers dynamically
  const getIceServers = async () => {
    try {
      Logger.debug('GuidedSession', 'Fetching TURN credentials from server');
      const response = await fetch('/api/turn-credentials');
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      Logger.info('GuidedSession', 'Successfully fetched TURN credentials', {
        serverCount: data.iceServers.length
      });
      
      // Log detailed information about the ICE servers for debugging
      Logger.debug('GuidedSession', 'ICE servers configuration', { 
        serverCount: data.iceServers.length,
        urls: data.iceServers.map((server: any) => server.urls),
        hasCredentials: data.iceServers.map((server: any) => !!server.credential && !!server.username)
      });
      
      return data.iceServers;
    } catch (error) {
      Logger.error('GuidedSession', 'Error getting TURN servers', error);
      
      // Fall back to public STUN servers and the public Metered TURN server
      // Prioritizing TCP transport for better NAT traversal
      Logger.warn('GuidedSession', 'Using fallback ICE servers');
      const fallbackServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Public Metered TURN servers as fallback - prioritize TCP
        { 
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        { 
          urls: 'turns:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        // Include UDP options as last resort
        { 
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ];
      
      Logger.debug('GuidedSession', 'Fallback ICE servers', { 
        serverCount: fallbackServers.length,
        urls: fallbackServers.map(server => server.urls)
      });
      
      return fallbackServers;
    }
  };

  // Modify the initializeConnection function to use dynamic ICE servers
  const initializeConnection = async () => {
    Logger.info('GuidedSession', 'Initializing connection to OpenAI Realtime API');
    try {
      setError(null);
      
      // Get microphone access if we don't already have it
      if (!mediaStreamRef.current || !mediaStreamRef.current.getAudioTracks()[0]?.enabled) {
        Logger.debug('GuidedSession', 'Requesting microphone access');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        mediaStreamRef.current = stream;
        Logger.info('GuidedSession', 'Microphone access granted', { 
          tracks: stream.getAudioTracks().length,
          trackSettings: stream.getAudioTracks()[0]?.getSettings() 
        });
      } else {
        Logger.debug('GuidedSession', 'Reusing existing microphone access');
      }
      
      // Get ephemeral key from server action
      Logger.debug('GuidedSession', 'Requesting ephemeral key from server action');
      const ephemeralKey = await getEphemeralKey();
      Logger.info('GuidedSession', 'Received ephemeral key from server');
      
      // Store the ephemeral key for use in ICE restarts
      ephemeralKeyRef.current = ephemeralKey;
      
      // Get TURN credentials
      const iceServers = await getIceServers();
      
      // Create WebRTC peer connection with dynamic ICE servers
      Logger.debug('GuidedSession', 'Creating WebRTC peer connection');
      const peerConnection = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
      });
      peerConnectionRef.current = peerConnection;
      
      // Enhanced event listeners for connection state
      peerConnection.onconnectionstatechange = () => {
        Logger.info('GuidedSession', 'Connection state changed', { state: peerConnection.connectionState });
        
        if (peerConnection.connectionState === 'failed') {
          Logger.error('GuidedSession', 'Connection state failed', { state: peerConnection.connectionState });
          if (isListening) {
            attemptConnectionRecovery();
          }
        } else if (peerConnection.connectionState === 'disconnected') {
          Logger.warn('GuidedSession', 'Connection state disconnected, may recover automatically', { 
            state: peerConnection.connectionState 
          });
          // Start a timer to attempt recovery if disconnection persists
          setTimeout(() => {
            if (peerConnectionRef.current?.connectionState === 'disconnected' && isListening) {
              Logger.warn('GuidedSession', 'Connection still disconnected after timeout, attempting recovery');
              attemptConnectionRecovery();
            }
          }, 5000); // Wait 5 seconds before attempting recovery
        } else if (peerConnection.connectionState === 'connected') {
          Logger.info('GuidedSession', 'Connection established successfully');
          // Reset recovery attempts counter on successful connection
          recoveryAttemptsRef.current = 0;
        }
      };
      
      peerConnection.oniceconnectionstatechange = () => {
        Logger.info('GuidedSession', 'ICE connection state changed', { 
          state: peerConnection.iceConnectionState,
          candidatesGathered: peerConnection.iceGatheringState
        });
        
        if (peerConnection.iceConnectionState === 'failed') {
          Logger.error('GuidedSession', 'ICE connection failed', { 
            iceConnectionState: peerConnection.iceConnectionState,
            connectionState: peerConnection.connectionState,
            signalingState: peerConnection.signalingState
          });
          setError('WebRTC ICE connection failed. This could be due to network issues or firewall restrictions.');
          
          // Attempt full ICE restart if the connection has failed
          if (isListening && peerConnectionRef.current && ephemeralKeyRef.current) {
            Logger.info('GuidedSession', 'Attempting full ICE restart');
            try {
              // Create a new offer with iceRestart: true to force ICE renegotiation
              peerConnectionRef.current.createOffer({ iceRestart: true })
                .then(offer => {
                  return peerConnectionRef.current!.setLocalDescription(offer);
                })
                .then(() => {
                  Logger.info('GuidedSession', 'ICE restarted, resending offer to API');
                  if (peerConnectionRef.current!.localDescription) {
                    return fetch('https://api.openai.com/v1/realtime?intent=transcription', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${ephemeralKeyRef.current}`,
                        'Content-Type': 'application/sdp',
                        'OpenAI-Beta': 'realtime=v1'
                      },
                      body: peerConnectionRef.current!.localDescription.sdp
                    });
                  }
                })
                .then(response => {
                  if (!response || !response.ok) {
                    Logger.error('GuidedSession', 'Failed to resend offer to API', { 
                      status: response?.status, 
                      statusText: response?.statusText 
                    });
                    throw new Error('Failed to resend offer to API');
                  }
                  return response.text();
                })
                .then(sdpText => {
                  if (!sdpText || sdpText.trim() === '') {
                    Logger.error('GuidedSession', 'Empty SDP received from API during ICE restart');
                    throw new Error('Empty SDP received from API during ICE restart');
                  }
                  
                  Logger.debug('GuidedSession', 'Received SDP answer for ICE restart', { 
                    sdpLength: sdpText.length 
                  });
                  
                  const answer = { type: 'answer', sdp: sdpText } as RTCSessionDescriptionInit;
                  return peerConnectionRef.current!.setRemoteDescription(answer);
                })
                .then(() => {
                  Logger.info('GuidedSession', 'ICE restart completed successfully');
                })
                .catch(err => {
                  Logger.error('GuidedSession', 'ICE restart failed', err);
                  attemptConnectionRecovery();
                });
            } catch (err) {
              Logger.error('GuidedSession', 'Error attempting ICE restart', err);
              attemptConnectionRecovery();
            }
          }
        } else if (peerConnection.iceConnectionState === 'disconnected') {
          Logger.warn('GuidedSession', 'ICE connection disconnected, attempting recovery');
          
          // Set a shorter timeout for recovery attempts when disconnected
          setTimeout(() => {
            if (peerConnectionRef.current?.iceConnectionState === 'disconnected' && isListening && ephemeralKeyRef.current) {
              Logger.warn('GuidedSession', 'ICE still disconnected after timeout, attempting restart');
              if (peerConnectionRef.current) {
                try {
                  // Try to restart ICE negotiation
                  peerConnectionRef.current.createOffer({ iceRestart: true })
                    .then(offer => peerConnectionRef.current!.setLocalDescription(offer))
                    .then(() => {
                      Logger.info('GuidedSession', 'ICE restarted after disconnect, resending offer');
                      if (peerConnectionRef.current!.localDescription) {
                        return fetch('https://api.openai.com/v1/realtime?intent=transcription', {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${ephemeralKeyRef.current}`,
                            'Content-Type': 'application/sdp',
                            'OpenAI-Beta': 'realtime=v1'
                          },
                          body: peerConnectionRef.current!.localDescription.sdp
                        });
                      }
                    })
                    .then(response => {
                      if (!response || !response.ok) throw new Error('Failed to resend offer after disconnect');
                      return response.text();
                    })
                    .then(sdpText => {
                      const answer = { type: 'answer', sdp: sdpText } as RTCSessionDescriptionInit;
                      return peerConnectionRef.current!.setRemoteDescription(answer);
                    })
                    .then(() => {
                      Logger.info('GuidedSession', 'ICE restart after disconnect completed successfully');
                    })
                    .catch(err => {
                      Logger.error('GuidedSession', 'ICE restart after disconnect failed', err);
                      attemptConnectionRecovery();
                    });
                } catch (err) {
                  Logger.error('GuidedSession', 'Error restarting ICE after disconnect', err);
                  attemptConnectionRecovery();
                }
              }
            }
          }, 2000); // Reduced from 5000ms to respond more quickly to disconnections
        } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
          Logger.info('GuidedSession', 'ICE connection established', { 
            state: peerConnection.iceConnectionState
          });
        }
      };
      
      peerConnection.onicegatheringstatechange = () => {
        Logger.info('GuidedSession', 'ICE gathering state changed', { state: peerConnection.iceGatheringState });
      };
      
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateStr = event.candidate.candidate;
          const type = candidateStr.includes(' host ') ? 'host' : 
                      candidateStr.includes(' srflx ') ? 'srflx' :
                      candidateStr.includes(' relay ') ? 'relay' : 'unknown';
                  
          Logger.debug('GuidedSession', 'ICE candidate', { 
            type,
            candidate: candidateStr,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            iceGatheringState: peerConnection.iceGatheringState 
          });
          
          // Log when we get relay candidates, which are essential for connection stability
          if (type === 'relay') {
            Logger.info('GuidedSession', 'Relay candidate gathered', {
              candidate: candidateStr
            });
          }
        } else {
          // Null candidate signals the end of candidate gathering
          Logger.info('GuidedSession', 'ICE candidate gathering complete', {
            iceGatheringState: peerConnection.iceGatheringState
          });
        }
      };
      
      // Add error handler for peer connection
      peerConnection.onicecandidateerror = (event) => {
        Logger.error('GuidedSession', 'ICE candidate error', {
          errorCode: event.errorCode,
          errorText: event.errorText,
          url: event.url
        });
        
        // Log more detailed information about the error
        if (event.errorCode === 701) {
          Logger.error('GuidedSession', 'TURN allocation failed: Address not associated with desired network', {
            url: event.url
          });
        } else if (event.errorCode === 400) {
          Logger.error('GuidedSession', 'Bad request to TURN server - possible credential issue', {
            url: event.url
          });
        }
      };
      
      // Add audio tracks to peer connection
      Logger.debug('GuidedSession', 'Adding audio tracks to peer connection');
      const stream = mediaStreamRef.current!;
      stream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
        Logger.debug('GuidedSession', 'Added audio track', { 
          trackId: track.id, 
          enabled: track.enabled,
          muted: track.muted,
          kind: track.kind
        });
      });
      
      // Create data channel for events with enhanced reliability options
      Logger.debug('GuidedSession', 'Creating data channel');
      const dataChannel = peerConnection.createDataChannel('oai-events', {
        ordered: true,  // Ensure reliable and ordered delivery
        maxRetransmits: 10  // Limit retransmission attempts
      });
      dataChannelRef.current = dataChannel;
      
      // Enhanced data channel handlers
      dataChannel.onmessage = (event) => {
        try {
          // Log the raw message for debugging
          Logger.debug('GuidedSession', 'Raw data channel message received', { 
            dataLength: event.data.length,
            dataPreview: event.data.substring ? event.data.substring(0, 100) : 'Non-string data'
          });
          
          const data = JSON.parse(event.data) as TranscriptionEvent;
          Logger.debug('GuidedSession', 'Received event', { type: data.type, eventId: data.event_id });
          handleTranscriptionEvent(data);
        } catch (err) {
          Logger.error('GuidedSession', 'Error parsing event data', err);
        }
      };
      
      // Handle data channel state changes
      dataChannel.onopen = () => {
        Logger.info('GuidedSession', 'Data channel opened', { id: dataChannel.id, state: dataChannel.readyState });
        setIsConnected(true);
        
        // Start heartbeat to keep connection alive
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
        
        heartbeatIntervalRef.current = setInterval(() => {
          if (dataChannel.readyState === 'open') {
            // Send a heartbeat message to keep the connection alive
            dataChannel.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
            Logger.debug('GuidedSession', 'Sent heartbeat message');
          } else {
            Logger.warn('GuidedSession', 'Skipping heartbeat, data channel not open', { state: dataChannel.readyState });
            
            // If the data channel is closing or closed, attempt to recover the connection
            if (dataChannel.readyState === 'closing' || dataChannel.readyState === 'closed') {
              Logger.warn('GuidedSession', 'Data channel is closing/closed during heartbeat check');
              if (isListening) {
                attemptConnectionRecovery();
              }
            }
          }
        }, 3000); // Send a heartbeat every 3 seconds (reduced from 5 seconds to be more aggressive)
      };
      
      dataChannel.onclose = () => {
        Logger.info('GuidedSession', 'Data channel closed', { id: dataChannel.id, state: dataChannel.readyState });
        setIsConnected(false);
        
        // Clear heartbeat interval
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        
        // If we're still supposed to be listening, attempt recovery
        if (isListening) {
          Logger.warn('GuidedSession', 'Data channel closed while still listening, attempting recovery');
          attemptConnectionRecovery();
        }
      };
      
      dataChannel.onerror = (error) => {
        Logger.error('GuidedSession', 'Data channel error', error);
      };
      
      // Also listen for incoming data channels (in case server creates one)
      peerConnection.ondatachannel = (event) => {
        Logger.info('GuidedSession', 'Received data channel from server', { label: event.channel.label });
        const incomingChannel = event.channel;
        incomingChannel.onmessage = (msgEvent) => {
          Logger.debug('GuidedSession', 'Message from incoming data channel', { 
            data: msgEvent.data
          });
          
          try {
            const data = JSON.parse(msgEvent.data) as TranscriptionEvent;
            handleTranscriptionEvent(data);
          } catch (err) {
            Logger.error('GuidedSession', 'Error parsing event data from incoming channel', err);
          }
        };
      };
      
      // Create and set local description
      Logger.debug('GuidedSession', 'Creating offer');
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: false  // We're only sending audio, not receiving
      });
      
      Logger.debug('GuidedSession', 'Offer SDP', { sdp: offer.sdp });
      Logger.debug('GuidedSession', 'Setting local description');
      await peerConnection.setLocalDescription(offer);
      Logger.info('GuidedSession', 'Local description set', { type: offer.type });
      
      // Send offer to OpenAI Realtime API
      Logger.debug('GuidedSession', 'Sending offer to OpenAI Realtime API');
      const response = await fetch('https://api.openai.com/v1/realtime?intent=transcription', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1'
        },
        body: peerConnection.localDescription?.sdp
      });
      
      Logger.debug('GuidedSession', 'Received response from OpenAI Realtime API', { 
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries([...response.headers])
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        Logger.error('GuidedSession', 'Failed to connect to OpenAI Realtime API', { 
          status: response.status, 
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to connect to OpenAI Realtime API: ${response.status} ${response.statusText} ${errorText}`);
      }
      
      // Set remote description from response
      const sdpText = await response.text();
      Logger.debug('GuidedSession', 'Received SDP answer', { sdp: sdpText });
      
      if (!sdpText || sdpText.trim() === '') {
        Logger.error('GuidedSession', 'Empty SDP received from OpenAI API');
        throw new Error('Empty SDP received from OpenAI API');
      }
      
      const answer = {
        type: 'answer',
        sdp: sdpText
      } as RTCSessionDescriptionInit;
      
      Logger.debug('GuidedSession', 'Setting remote description');
      await peerConnection.setRemoteDescription(answer);
      Logger.info('GuidedSession', 'Remote description set', { type: answer.type });
      
      setIsListening(true);
      Logger.info('GuidedSession', 'WebRTC connection established successfully');
    } catch (err) {
      Logger.error('GuidedSession', 'Error initializing connection', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      cleanupConnection();
    }
  };
  
  // Clean up WebRTC connection
  const cleanupConnection = () => {
    Logger.info('GuidedSession', 'Cleaning up connection');
    
    // Clear heartbeat interval
    if (heartbeatIntervalRef.current) {
      Logger.debug('GuidedSession', 'Clearing heartbeat interval');
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    
    if (dataChannelRef.current) {
      Logger.debug('GuidedSession', 'Closing data channel', { state: dataChannelRef.current.readyState });
      dataChannelRef.current.close();
    }
    
    if (peerConnectionRef.current) {
      Logger.debug('GuidedSession', 'Closing peer connection', { state: peerConnectionRef.current.connectionState });
      peerConnectionRef.current.close();
    }
    
    if (mediaStreamRef.current) {
      Logger.debug('GuidedSession', 'Stopping media tracks');
      mediaStreamRef.current.getTracks().forEach(track => {
        track.stop();
        Logger.debug('GuidedSession', 'Stopped track', { trackId: track.id });
      });
    }
    
    // Reset recovery attempts
    recoveryAttemptsRef.current = 0;
    
    setIsConnected(false);
    setIsListening(false);
    Logger.info('GuidedSession', 'Connection cleaned up');
  };
  
  // Handle transcription events from OpenAI
  const handleTranscriptionEvent = (event: TranscriptionEvent) => {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.delta':
        // Handle incremental transcription updates
        Logger.debug('GuidedSession', 'Transcription delta received', { 
          itemId: event.item_id, 
          contentIndex: event.content_index,
          delta: event.delta
        });
        setTranscription(prev => prev + event.delta);
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        // Handle completed transcription
        Logger.info('GuidedSession', 'Transcription completed', { 
          itemId: event.item_id, 
          transcript: event.transcript
        });
        // For completed transcriptions, we could replace the current text or append it
        setTranscription(event.transcript);
        break;
        
      case 'input_audio_buffer.speech_started':
        Logger.info('GuidedSession', 'Speech started', { itemId: event.item_id });
        break;
        
      case 'input_audio_buffer.speech_stopped':
        Logger.info('GuidedSession', 'Speech stopped', { itemId: event.item_id });
        break;
        
      default:
        Logger.warn('GuidedSession', 'Unhandled event type', event);
    }
  };
  
  // Log state changes
  useEffect(() => {
    Logger.info('GuidedSession', 'Connection state changed', { isConnected });
  }, [isConnected]);
  
  useEffect(() => {
    Logger.info('GuidedSession', 'Listening state changed', { isListening });
  }, [isListening]);
  
  useEffect(() => {
    if (error) {
      Logger.error('GuidedSession', 'Error state set', { error });
    }
  }, [error]);
  
  return (
    <div className="guided-session flex flex-col h-full">
      <div className="mb-4 text-center">
        <button
          onClick={isListening ? cleanupConnection : initializeConnection}
          className={`px-4 py-2 rounded-lg font-medium ${
            isListening 
              ? 'bg-red-500 hover:bg-red-600 text-white' 
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isListening ? 'Stop Listening' : 'Start Listening'}
        </button>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>{error}</p>
        </div>
      )}
      
      <div className="flex-grow overflow-y-auto rounded-lg border-2 p-4 bg-gray-50 dark:bg-gray-900">
        <div className="chat-component">
          {transcription ? (
            <div className="pb-2">
              <div className="font-medium text-gray-700 dark:text-gray-300">You said:</div>
              <div className="mt-1 p-3 bg-white dark:bg-gray-800 rounded-lg shadow">
                {transcription}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              {isListening 
                ? 'Speak now... your words will appear here' 
                : 'Click "Start Listening" and speak into your microphone'}
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-4 text-xs text-gray-500 text-center">
        {isConnected 
          ? 'Connected to OpenAI Realtime API' 
          : 'Not connected to OpenAI Realtime API'}
      </div>
    </div>
  );
} 
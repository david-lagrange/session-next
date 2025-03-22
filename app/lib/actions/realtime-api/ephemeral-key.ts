'use server';

/**
 * Logger utility for server-side logs
 */
const ServerLogger = {
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
    if (error instanceof Error) {
      console.error(`[${timestamp}] [ERROR] [${component}] Stack trace:`, error.stack);
    }
  },
  debug: (component: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.debug(`[${timestamp}] [DEBUG] [${component}] ${message}`, data || '');
  }
};

/**
 * Generates an ephemeral key for OpenAI's Realtime API
 * This key is used for client-side WebRTC connections
 */
export async function getEphemeralKey() {
  ServerLogger.info('EphemeralKey', 'Generating ephemeral key for OpenAI Realtime API');
  
  if (!process.env.OPENAI_API_KEY) {
    ServerLogger.error('EphemeralKey', 'OPENAI_API_KEY environment variable is not defined');
    throw new Error('OPENAI_API_KEY is not defined');
  }

  try {
    const requestBody = {
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: "gpt-4o-transcribe",
        language: "en"
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      input_audio_noise_reduction: {
        type: "near_field"
      },
      connection_timeout_s: 30
    };
    
    ServerLogger.debug('EphemeralKey', 'Request body prepared', { 
      audioFormat: requestBody.input_audio_format,
      transcriptionModel: requestBody.input_audio_transcription.model,
      language: requestBody.input_audio_transcription.language,
      vadType: requestBody.turn_detection.type,
      connectionTimeout: requestBody.connection_timeout_s
    });
    
    ServerLogger.info('EphemeralKey', 'Sending request to OpenAI Realtime API for ephemeral key');
    const response = await fetch(
      "https://api.openai.com/v1/realtime/transcription_sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1"
        },
        body: JSON.stringify(requestBody),
      }
    );

    ServerLogger.debug('EphemeralKey', 'Received response from OpenAI API', { 
      status: response.status, 
      statusText: response.statusText,
      ok: response.ok 
    });

    if (!response.ok) {
      const errorData = await response.json();
      ServerLogger.error('EphemeralKey', 'Failed to get ephemeral key from OpenAI API', { 
        status: response.status,
        statusText: response.statusText, 
        error: errorData 
      });
      throw new Error(`Failed to get ephemeral key: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    ServerLogger.debug('EphemeralKey', 'Response data structure', {
      hasClientSecret: !!data.client_secret,
      secretType: data.client_secret ? typeof data.client_secret.value : 'undefined'
    });
    
    if (!data.client_secret || !data.client_secret.value) {
      ServerLogger.error('EphemeralKey', 'Missing client_secret in response', { responseKeys: Object.keys(data) });
      throw new Error('Invalid response format: missing client_secret');
    }
    
    ServerLogger.info('EphemeralKey', 'Successfully generated ephemeral key');
    return data.client_secret.value;
  } catch (error) {
    ServerLogger.error('EphemeralKey', 'Error generating ephemeral key', error);
    
    // Enhance error with more context
    const enhancedError = error instanceof Error 
      ? error 
      : new Error(String(error));
      
    if (enhancedError.message.includes('ECONNREFUSED') || enhancedError.message.includes('ETIMEDOUT')) {
      ServerLogger.error('EphemeralKey', 'Network connectivity issue detected. Check your internet connection.');
    } else if (enhancedError.message.includes('Unauthorized') || enhancedError.message.includes('401')) {
      ServerLogger.error('EphemeralKey', 'API key authentication failed. Check if your OpenAI API key is valid and has access to the Realtime API.');
    }
    
    throw enhancedError;
  }
} 
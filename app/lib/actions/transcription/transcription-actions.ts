'use server'

/**
 * Generates an ephemeral API key for OpenAI's Realtime Transcription API
 * This key is used to authenticate the WebRTC connection from the client
 */
export async function getEphemeralKey() {
  console.log('[ServerAction:getEphemeralKey] Starting ephemeral key request');
  try {
    const requestBody = {
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'gpt-4o-transcribe',
        prompt: '',
        language: 'en',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      input_audio_noise_reduction: {
        type: 'near_field'
      },
    };
    
    console.log('[ServerAction:getEphemeralKey] Request body:', JSON.stringify(requestBody));
    console.log('[ServerAction:getEphemeralKey] API Key present:', !!process.env.OPENAI_API_KEY);
    
    const response = await fetch(
      'https://api.openai.com/v1/realtime/transcription_sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('[ServerAction:getEphemeralKey] Response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[ServerAction:getEphemeralKey] Error response:', JSON.stringify(errorData));
      throw new Error(`Failed to get ephemeral key: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('[ServerAction:getEphemeralKey] Successfully received ephemeral key, data structure:', 
      JSON.stringify({
        hasClientSecret: !!data.client_secret,
        hasValue: !!data.client_secret?.value,
        sessionId: data.id,
        keys: Object.keys(data)
      })
    );
    return data.client_secret?.value;
  } catch (error) {
    console.error('[ServerAction:getEphemeralKey] Error:', error);
    throw error;
  }
} 
'use server'

export async function createTranscriptionSession() {
  console.log("🔵 [Server Action] Creating transcription session...");
  try {
    const apiUrl = "https://api.openai.com/v1/realtime/transcription_sessions";
    console.log(`🔵 [Server Action] Sending request to: ${apiUrl}`);
    
    if (!process.env.OPENAI_API_KEY) {
      console.error("🔴 [Server Action] OPENAI_API_KEY is not defined");
      throw new Error("API key not configured");
    }
    
    const response = await fetch(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input_audio_format: "pcm16", // 16-bit PCM, 24kHz, mono
          input_audio_transcription: {
            model: "gpt-4o-transcribe", // Transcription model
            language: "en", // Optional: specify language for better accuracy
            prompt: "", // Optional: guide transcription
          },
          turn_detection: {
            type: "server_vad", // Enable server-side VAD
            threshold: 0.5, // Audio activation threshold
            prefix_padding_ms: 300, // Audio before speech detection
            silence_duration_ms: 500, // Silence duration to detect speech end
          },
          input_audio_noise_reduction: {
            type: "near_field", // Noise reduction for close microphones
          },
        }),
      }
    );

    console.log(`🔵 [Server Action] Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error(`🔴 [Server Action] API Error:`, errorData);
      throw new Error(`Failed to create transcription session: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log(`🟢 [Server Action] Session created successfully, client secret length: ${data.client_secret?.value?.length || 0}`);
    
    return { clientSecret: data.client_secret.value };
  } catch (error) {
    console.error("🔴 [Server Action] Error creating transcription session:", error);
    throw error;
  }
} 
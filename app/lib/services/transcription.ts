import { createTranscriptionSession } from "@/app/lib/actions/transcription/create-session";

export interface TranscriptionEvents {
  onTranscriptionUpdate: (text: string) => void;
  onTranscriptionCompleted: (fullTranscript: string) => void;
  onError: (message: string) => void;
  onStatusChange: (status: TranscriptionStatus) => void;
}

export type TranscriptionStatus = 'idle' | 'connecting' | 'active' | 'error' | 'closed';

export class TranscriptionService {
  private ws: WebSocket | null = null;
  private events: TranscriptionEvents;
  private status: TranscriptionStatus = 'idle';

  constructor(events: TranscriptionEvents) {
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.status === 'active' || this.status === 'connecting') return;
    
    try {
      this.setStatus('connecting');
      console.log("🔷 [Transcription] Fetching client secret from server action...");
      
      const { clientSecret } = await createTranscriptionSession();
      console.log(`🔷 [Transcription] Received client secret, length: ${clientSecret.length}`);
      
      console.log("🔷 [Transcription] Creating WebSocket connection...");
      this.ws = new WebSocket(
        "wss://api.openai.com/v1/realtime?intent=transcription",
        [
          "realtime",
          `openai-insecure-api-key.${clientSecret}`,
          "openai-beta.realtime-v1"
        ]
      );
      
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      
    } catch (error: any) {
      console.error("🔴 [Transcription] Error setting up WebSocket:", error);
      this.setStatus('error');
      this.events.onError(`Error: ${error.message || "Unknown error"}`);
    }
  }

  stop(): void {
    if (this.ws) {
      console.log("🔷 [Transcription] Closing WebSocket connection");
      this.ws.close();
      this.ws = null;
      this.setStatus('idle');
    }
  }

  sendAudio(audioData: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: this.arrayBufferToBase64(audioData),
        })
      );
    }
  }

  private handleOpen(): void {
    console.log("🟢 [Transcription] WebSocket connection opened");
    this.setStatus('active');
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      
      if (message.type === "error") {
        console.error("🔴 [Transcription] Error from WebSocket:", message.error);
        this.events.onError(`API Error: ${message.error.message || "Unknown error"}`);
        return;
      }
      
      switch (message.type) {
        case "conversation.item.input_audio_transcription.delta":
          console.log(`🟢 [Transcription] Transcription delta: "${message.delta}"`);
          this.events.onTranscriptionUpdate(message.delta);
          break;
        case "conversation.item.input_audio_transcription.completed":
          console.log(`🟢 [Transcription] Transcription completed: "${message.transcript}"`);
          this.events.onTranscriptionCompleted(message.transcript);
          this.events.onTranscriptionUpdate(" ");
          break;
        case "input_audio_buffer.speech_started":
          console.log("🟢 [Transcription] Speech started");
          break;
        case "input_audio_buffer.speech_stopped":
          console.log("🟢 [Transcription] Speech stopped");
          break;
        default:
          console.log(`🟠 [Transcription] Unhandled event type: ${message.type}`);
      }
    } catch (err) {
      console.error("🔴 [Transcription] Error parsing message:", err, event.data);
    }
  }

  private handleClose(event: CloseEvent): void {
    console.log(`🟠 [Transcription] WebSocket closed with code ${event.code}: ${event.reason}`);
    this.setStatus('closed');
    if (this.status === 'active' || this.status === 'connecting') {
      this.events.onError(`Connection closed: ${event.reason || "Unknown reason"}`);
    }
    this.ws = null;
  }

  private handleError(error: Event): void {
    console.error("🔴 [Transcription] WebSocket error:", error);
    this.setStatus('error');
    this.events.onError("WebSocket connection error");
    this.ws = null;
  }

  private setStatus(status: TranscriptionStatus): void {
    this.status = status;
    this.events.onStatusChange(status);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
} 
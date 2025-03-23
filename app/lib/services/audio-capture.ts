export interface AudioCaptureOptions {
  sampleRate?: number;
  onAudioData: (audioData: ArrayBuffer) => void;
}

export class AudioCaptureService {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isCapturing = false;
  private options: AudioCaptureOptions;
  private packetCount = 0;

  constructor(options: AudioCaptureOptions) {
    this.options = {
      sampleRate: 24000,
      ...options
    };
  }

  async start(): Promise<void> {
    if (this.isCapturing) return;
    
    try {
      console.log("🔷 [AudioCapture] Requesting microphone access...");
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("🟢 [AudioCapture] Microphone access granted");

      console.log(`🔷 [AudioCapture] Creating audio context (${this.options.sampleRate}Hz)...`);
      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      console.log("🔷 [AudioCapture] Setting up audio processor...");
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16Data = this.convertToPCM16(inputData);
        
        this.packetCount++;
        if (this.packetCount % 10 === 0) {
          console.log(`🟢 [AudioCapture] Processing audio packet #${this.packetCount} (${pcm16Data.byteLength} bytes)`);
        }
        
        this.options.onAudioData(pcm16Data);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.isCapturing = true;
      console.log("🟢 [AudioCapture] Audio capture started");
    } catch (error) {
      console.error("🔴 [AudioCapture] Error starting audio capture:", error);
      this.cleanup();
      throw new Error("Could not access microphone");
    }
  }

  stop(): void {
    this.cleanup();
  }

  private cleanup(): void {
    console.log("🔷 [AudioCapture] Running cleanup");
    
    if (this.processor && this.source && this.audioContext) {
      console.log("🔷 [AudioCapture] Disconnecting audio nodes");
      this.source.disconnect(this.processor);
      this.processor.disconnect(this.audioContext.destination);
    }
    
    if (this.stream) {
      console.log("🔷 [AudioCapture] Stopping audio tracks");
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    
    if (this.audioContext) {
      console.log("🔷 [AudioCapture] Closing audio context");
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.isCapturing = false;
    console.log("🟢 [AudioCapture] Cleanup completed");
  }

  private convertToPCM16(floatArray: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(floatArray.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < floatArray.length; i++) {
      const s = Math.max(-1, Math.min(1, floatArray[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }
} 
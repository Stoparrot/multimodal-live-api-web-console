/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createWorketFromSrc,
  registeredWorklets,
} from "./audioworklet-registry";

export class AudioStreamer {
  public audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  private sampleRate: number = 24000;
  private bufferSize: number = 7680;
  private processingBuffer: Float32Array = new Float32Array(0);
  private scheduledTime: number = 0;
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private initialBufferTime: number = 0.1; //0.1 // 100ms initial buffer
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public onComplete = () => {};

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
    
    // Set initial gain
    this.gainNode.gain.value = 1.0;
    
    console.log(`AudioStreamer created with context state: ${this.context.state}`);
  }

  async addWorklet<T>(
    name: string,
    workletSrc: string,
    handler: (ev: MessageEvent<T>) => void,
  ) {
    try {
      console.log(`Adding worklet ${name} to AudioStreamer...`);
      
      // Ensure context is running
      if (this.context.state !== "running") {
        console.log(`Resuming context before adding worklet, current state: ${this.context.state}`);
        await this.context.resume();
      }
      
      const src = createWorketFromSrc(name, workletSrc);
      await this.context.audioWorklet.addModule(src);
      const node = new AudioWorkletNode(this.context, name);
      const handlers = [handler];
      const worklets = registeredWorklets.get(this.context) || {};
      worklets[name] = { node, handlers };
      registeredWorklets.set(this.context, worklets);
      console.log(`Worklet ${name} added successfully`);
      return node;
    } catch (error) {
      console.error(`Failed to add worklet ${name}:`, error);
      throw error;
    }
  }

  addPCM16(chunk: Uint8Array) {
    if (this.context.state !== "running") {
      console.log(`Audio context not running (state: ${this.context.state}), attempting to resume...`);
      this.context.resume().catch(err => console.error("Failed to resume context:", err));
    }
    
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);

    for (let i = 0; i < chunk.length / 2; i++) {
      try {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768;
      } catch (e) {
        console.error(e);
      }
    }

    const newBuffer = new Float32Array(
      this.processingBuffer.length + float32Array.length,
    );
    newBuffer.set(this.processingBuffer);
    newBuffer.set(float32Array, this.processingBuffer.length);
    this.processingBuffer = newBuffer;

    while (this.processingBuffer.length >= this.bufferSize) {
      const buffer = this.processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      this.processingBuffer = this.processingBuffer.slice(this.bufferSize);
    }

    if (!this.isPlaying) {
      console.log("Starting audio playback chain...");
      this.isPlaying = true;
      // Initialize scheduledTime only when we start playing
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate,
    );
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    const SCHEDULE_AHEAD_TIME = 0.2;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) {
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          if (
            !this.audioQueue.length &&
            this.endOfQueueAudioSource === source
          ) {
            this.endOfQueueAudioSource = null;
            this.onComplete();
          }
        };
      }

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const worklets = registeredWorklets.get(this.context);

      if (worklets) {
        Object.entries(worklets).forEach(([workletName, graph]) => {
          const { node, handlers } = graph;
          if (node) {
            source.connect(node);
            node.port.onmessage = function (ev: MessageEvent) {
              handlers.forEach((handler) => {
                handler.call(node.port, ev);
              });
            };
            node.connect(this.context.destination);
          }
        });
      }

      // i added this trying to fix clicks
      // this.gainNode.gain.setValueAtTime(0, 0);
      // this.gainNode.gain.linearRampToValueAtTime(1, 1);

      // Ensure we never schedule in the past
      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);

      this.scheduledTime = startTime + audioBuffer.duration;
    }

    if (this.audioQueue.length === 0 && this.processingBuffer.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          this.checkInterval = window.setInterval(() => {
            if (
              this.audioQueue.length > 0 ||
              this.processingBuffer.length >= this.bufferSize
            ) {
              this.scheduleNextBuffer();
            }
          }, 100) as unknown as number;
        }
      }
    } else {
      const nextCheckTime =
        (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(
        () => this.scheduleNextBuffer(),
        Math.max(0, nextCheckTime - 50),
      );
    }
  }

  stop() {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.processingBuffer = new Float32Array(0);
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.gainNode.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + 0.1,
    );

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  async resume() {
    console.log(`Resuming AudioStreamer, context state: ${this.context.state}`);
    
    if (this.context.state === "suspended") {
      try {
        console.log("Resuming suspended audio context...");
        await this.context.resume();
        console.log(`Context resumed, new state: ${this.context.state}`);
      } catch (error) {
        console.error("Failed to resume audio context:", error);
      }
    }
    
    // Restore gain to normal
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
    
    // Reset stream state
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    
    // Restart playback if we have buffered audio
    if (this.audioQueue.length > 0 && !this.isPlaying) {
      console.log("Restarting playback of buffered audio");
      this.isPlaying = true;
      this.scheduleNextBuffer();
    }
  }

  complete() {
    this.isStreamComplete = true;
    if (this.processingBuffer.length > 0) {
      this.audioQueue.push(this.processingBuffer);
      this.processingBuffer = new Float32Array(0);
      if (this.isPlaying) {
        this.scheduleNextBuffer();
      }
    } else {
      this.onComplete();
    }
  }
}

// // Usage example:
// const audioStreamer = new AudioStreamer();
//
// // In your streaming code:
// function handleChunk(chunk: Uint8Array) {
//   audioStreamer.handleChunk(chunk);
// }
//
// // To start playing (call this in response to a user interaction)
// await audioStreamer.resume();
//
// // To stop playing
// // audioStreamer.stop();

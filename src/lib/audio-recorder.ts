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

import { audioContext } from "./utils";
import AudioRecordingWorklet from "./worklets/audio-processing";
import VolMeterWorket from "./worklets/vol-meter";

import { createWorketFromSrc } from "./audioworklet-registry";
import EventEmitter from "eventemitter3";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export class AudioRecorder extends EventEmitter {
  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;
  vuWorklet: AudioWorkletNode | undefined;
  lastError: Error | null = null;

  private starting: Promise<void> | null = null;

  constructor(public sampleRate = 16000) {
    super();
  }

  async start() {
    // Reset previous error state
    this.lastError = null;
    
    if (this.recording) {
      console.log("AudioRecorder: Already recording");
      return Promise.resolve();
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error("Could not request user media - API not available");
      this.lastError = error;
      this.emit("error", error);
      return Promise.reject(error);
    }

    // Check if microphone is already in use or not available
    if (this.stream) {
      try {
        // Clean up previous stream if exists
        this.stop();
      } catch (e) {
        console.warn("Error cleaning up previous stream:", e);
      }
    }

    this.starting = new Promise(async (resolve, reject) => {
      try {
        console.log("AudioRecorder: Requesting microphone access...");
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        console.log("AudioRecorder: Microphone access granted");
        
        console.log("AudioRecorder: Creating audio context...");
        this.audioContext = await audioContext({ sampleRate: this.sampleRate });
        
        // Explicitly resume the audio context - needed in some browsers
        if (this.audioContext.state !== "running") {
          console.log("AudioRecorder: Resuming audio context from state:", this.audioContext.state);
          await this.audioContext.resume();
          console.log("AudioRecorder: Audio context now in state:", this.audioContext.state);
        }
        
        console.log("AudioRecorder: Creating media stream source...");
        this.source = this.audioContext.createMediaStreamSource(this.stream);

        console.log("AudioRecorder: Setting up recording worklet...");
        const workletName = "audio-recorder-worklet";
        const src = createWorketFromSrc(workletName, AudioRecordingWorklet);

        await this.audioContext.audioWorklet.addModule(src);
        this.recordingWorklet = new AudioWorkletNode(
          this.audioContext,
          workletName,
        );

        this.recordingWorklet.port.onmessage = async (ev: MessageEvent) => {
          // worklet processes recording floats and messages converted buffer
          const arrayBuffer = ev.data.data.int16arrayBuffer;

          if (arrayBuffer) {
            const arrayBufferString = arrayBufferToBase64(arrayBuffer);
            this.emit("data", arrayBufferString);
          }
        };
        this.source.connect(this.recordingWorklet);

        // vu meter worklet
        console.log("AudioRecorder: Setting up volume meter worklet...");
        const vuWorkletName = "vu-meter";
        await this.audioContext.audioWorklet.addModule(
          createWorketFromSrc(vuWorkletName, VolMeterWorket),
        );
        this.vuWorklet = new AudioWorkletNode(this.audioContext, vuWorkletName);
        this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
          this.emit("volume", ev.data.volume);
        };

        this.source.connect(this.vuWorklet);
        this.recording = true;
        console.log("AudioRecorder: Successfully started recording");
        resolve();
      } catch (error) {
        console.error("Error starting audio recorder:", error);
        this.lastError = error as Error;
        this.emit("error", error);
        reject(error);
      }
      this.starting = null;
    });
    
    return this.starting;
  }

  stop() {
    console.log("AudioRecorder: Stopping...");
    // its plausible that stop would be called before start completes
    // such as if the websocket immediately hangs up
    const handleStop = () => {
      if (this.source) {
        console.log("AudioRecorder: Disconnecting source");
        this.source.disconnect();
      }
      
      if (this.stream) {
        console.log("AudioRecorder: Stopping media tracks");
        this.stream.getTracks().forEach((track) => track.stop());
      }
      
      this.stream = undefined;
      this.recordingWorklet = undefined;
      this.vuWorklet = undefined;
      this.recording = false;
      console.log("AudioRecorder: Stopped");
    };
    
    if (this.starting) {
      console.log("AudioRecorder: Waiting for start to complete before stopping");
      this.starting.then(handleStop).catch(() => {
        // If starting failed, we should still clean up
        handleStop();
      });
      return;
    }
    
    handleStop();
  }
}

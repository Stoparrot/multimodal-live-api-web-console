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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MultimodalLiveAPIClientConnection,
  MultimodalLiveClient,
} from "../lib/multimodal-live-client";
import { LiveConfig } from "../multimodal-live-types";
import { AudioStreamer } from "../lib/audio-streamer";
import { audioContext } from "../lib/utils";
import VolMeterWorket from "../lib/worklets/vol-meter";

export type UseLiveAPIResults = {
  client: MultimodalLiveClient;
  setConfig: (config: LiveConfig) => void;
  config: LiveConfig;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  volume: number;
};

export function useLiveAPI({
  url,
  apiKey,
}: MultimodalLiveAPIClientConnection): UseLiveAPIResults {
  const client = useMemo(
    () => new MultimodalLiveClient({ url, apiKey }),
    [url, apiKey],
  );
  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<LiveConfig>({
    model: "models/gemini-2.0-flash-exp",
  });
  const [volume, setVolume] = useState(0);

  // register audio for streaming server -> speakers
  useEffect(() => {
    const initAudioStreamer = async () => {
      try {
        console.log("Initializing audio output context...");
        const audioCtx = await audioContext({ id: "audio-out" });
        
        console.log("Creating AudioStreamer...");
        audioStreamerRef.current = new AudioStreamer(audioCtx);
        
        // Ensure context is resumed
        if (audioCtx.state !== "running") {
          console.log("Resuming audio output context from state:", audioCtx.state);
          await audioCtx.resume();
          console.log("Audio output context now in state:", audioCtx.state);
        }
        
        console.log("Adding volume meter worklet to output stream...");
        await audioStreamerRef.current.addWorklet<any>(
          "vumeter-out", 
          VolMeterWorket, 
          (ev: any) => {
            setVolume(ev.data.volume);
          }
        );
        console.log("Audio output system initialized successfully");
      } catch (error) {
        console.error("Failed to initialize audio output system:", error);
      }
    };
    
    if (!audioStreamerRef.current) {
      initAudioStreamer();
    }
  }, []);

  useEffect(() => {
    const onClose = () => {
      setConnected(false);
    };

    const stopAudioStreamer = () => {
      console.log("Stopping audio streamer due to interruption");
      audioStreamerRef.current?.stop();
    };

    const onAudio = (data: ArrayBuffer) => {
      if (!audioStreamerRef.current) {
        console.warn("Received audio data but AudioStreamer not initialized");
        return;
      }
      
      // Ensure audio is resumed before playing
      if (audioStreamerRef.current.context.state !== "running") {
        console.log("Resuming audio context before playback");
        audioStreamerRef.current.resume();
      }
      
      audioStreamerRef.current.addPCM16(new Uint8Array(data));
    };

    client
      .on("close", onClose)
      .on("interrupted", stopAudioStreamer)
      .on("audio", onAudio);

    return () => {
      client
        .off("close", onClose)
        .off("interrupted", stopAudioStreamer)
        .off("audio", onAudio);
    };
  }, [client]);

  const connect = useCallback(async () => {
    console.log("Connecting with config:", config);
    if (!config) {
      throw new Error("config has not been set");
    }
    
    // Make sure audio streamer is ready
    if (audioStreamerRef.current) {
      console.log("Resuming audio streamer for new connection");
      await audioStreamerRef.current.resume();
    } else {
      console.warn("AudioStreamer not initialized before connection");
    }
    
    client.disconnect();
    await client.connect(config);
    setConnected(true);
  }, [client, setConnected, config]);

  const disconnect = useCallback(async () => {
    client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  return {
    client,
    config,
    setConfig,
    connected,
    connect,
    disconnect,
    volume,
  };
}

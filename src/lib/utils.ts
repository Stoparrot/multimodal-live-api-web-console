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

export type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

const map: Map<string, AudioContext> = new Map();

export const audioContext: (
  options?: GetAudioContextOptions,
) => Promise<AudioContext> = (() => {
  let hasInteracted = false;
  const didInteract = new Promise((res) => {
    const handleInteraction = () => {
      hasInteracted = true;
      res(true);
      // Clean up event listeners after first interaction
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      window.removeEventListener("click", handleInteraction);
    };
    
    // Add all relevant interaction events, especially important for mobile
    window.addEventListener("pointerdown", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("touchstart", handleInteraction);
    window.addEventListener("click", handleInteraction);
    
    // Auto-unlock audio on first visibility change (helps with mobile browsers)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !hasInteracted) {
        // Create a silent audio element and try to play it
        const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
        silentAudio.play().then(() => {
          if (!hasInteracted) handleInteraction();
        }).catch(() => {
          // If it fails, we'll still need user interaction
        });
      }
    }, { once: true });
  });

  return async (options?: GetAudioContextOptions) => {
    // If we've already had user interaction or this is a subsequent call,
    // we can try to create the context directly without playing silent audio
    if (hasInteracted || options?.id) {
      try {
        if (options?.id && map.has(options.id)) {
          const ctx = map.get(options.id);
          if (ctx) {
            if (ctx.state !== "running") {
              try {
                await ctx.resume();
                console.log(`AudioContext (${options.id}) resumed successfully`);
              } catch (err) {
                console.error(`Failed to resume AudioContext (${options.id}):`, err);
              }
            }
            return ctx;
          }
        }
        
        console.log("Creating new AudioContext...");
        const ctx = new AudioContext(options);
        if (ctx.state !== "running") {
          try {
            await ctx.resume();
            console.log("New AudioContext resumed successfully");
          } catch (err) {
            console.error("Failed to resume new AudioContext:", err);
          }
        }
        if (options?.id) {
          map.set(options.id, ctx);
        }
        return ctx;
      } catch (e) {
        console.warn("Failed to create AudioContext directly, falling back to user interaction wait:", e);
      }
    }
    
    // If we haven't had interaction yet, or the direct creation failed, try with silent audio
    try {
      console.log("Attempting to initialize audio with silent audio playback...");
      const a = new Audio();
      a.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      await a.play();
      console.log("Silent audio played successfully");
      
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          if (ctx.state !== "running") {
            try {
              await ctx.resume();
              console.log(`AudioContext (${options.id}) resumed successfully`);
            } catch (err) {
              console.error(`Failed to resume AudioContext (${options.id}):`, err);
            }
          }
          return ctx;
        }
      }
      
      const ctx = new AudioContext(options);
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
          console.log("New AudioContext resumed successfully");
        } catch (err) {
          console.error("Failed to resume new AudioContext:", err);
        }
      }
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    } catch (e) {
      console.warn("Audio initialization failed, waiting for user interaction:", e);
      await didInteract;
      console.log("User interaction detected, creating AudioContext...");
      
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          if (ctx.state !== "running") {
            try {
              await ctx.resume();
              console.log(`AudioContext (${options.id}) resumed successfully after interaction`);
            } catch (err) {
              console.error(`Failed to resume AudioContext (${options.id}) after interaction:`, err);
            }
          }
          return ctx;
        }
      }
      
      const ctx = new AudioContext(options);
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
          console.log("New AudioContext resumed successfully after interaction");
        } catch (err) {
          console.error("Failed to resume new AudioContext after interaction:", err);
        }
      }
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    }
  };
})();

export const blobToJSON = (blob: Blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        const json = JSON.parse(reader.result as string);
        resolve(json);
      } else {
        reject("oops");
      }
    };
    reader.readAsText(blob);
  });

export function base64ToArrayBuffer(base64: string) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

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

import cn from "classnames";

import { memo, ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { UseMediaStreamResult } from "../../hooks/use-media-stream-mux";
import { useScreenCapture } from "../../hooks/use-screen-capture";
import { useWebcam } from "../../hooks/use-webcam";
import { AudioRecorder } from "../../lib/audio-recorder";
import AudioPulse from "../audio-pulse/AudioPulse";
import "./control-tray.scss";

export type ControlTrayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  children?: ReactNode;
  supportsVideo: boolean;
  onVideoStreamChange?: (stream: MediaStream | null) => void;
};

type MediaStreamButtonProps = {
  isStreaming: boolean;
  onIcon: string;
  offIcon: string;
  start: () => Promise<any>;
  stop: () => any;
};

/**
 * button used for triggering webcam or screen-capture
 */
const MediaStreamButton = memo(
  ({ isStreaming, onIcon, offIcon, start, stop }: MediaStreamButtonProps) =>
    isStreaming ? (
      <button className="action-button" onClick={stop}>
        <span className="material-symbols-outlined">{onIcon}</span>
      </button>
    ) : (
      <button className="action-button" onClick={start}>
        <span className="material-symbols-outlined">{offIcon}</span>
      </button>
    ),
);

function ControlTray({
  videoRef,
  children,
  onVideoStreamChange = () => {},
  supportsVideo,
}: ControlTrayProps) {
  const videoStreams = [useWebcam(), useScreenCapture()];
  const [activeVideoStream, setActiveVideoStream] =
    useState<MediaStream | null>(null);
  const [webcam, screenCapture] = videoStreams;
  const [inVolume, setInVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [muted, setMuted] = useState(false);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<'inactive' | 'active' | 'error'>('inactive');

  const { client, connected, connect, disconnect, volume } =
    useLiveAPIContext();

  // Function to request microphone permissions explicitly
  const requestMicrophonePermission = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionError(null);
      return true;
    } catch (error) {
      console.error("Microphone permission error:", error);
      setMicPermissionError("Microphone access denied. Please allow microphone access in your browser settings.");
      return false;
    }
  };

  // Modified connect function to ensure microphone permissions before connecting
  const handleConnect = async () => {
    if (!connected) {
      const hasPermission = await requestMicrophonePermission();
      if (hasPermission) {
        connect();
      }
    } else {
      disconnect();
    }
  };

  // Listen for audio recorder errors
  useEffect(() => {
    const onError = (error: any) => {
      console.error("AudioRecorder error:", error);
      setMicStatus('error');
      setMicPermissionError(`Microphone error: ${error.message || 'Unknown error'}`);
    };

    audioRecorder.on("error", onError);
    
    return () => {
      audioRecorder.off("error", onError);
    };
  }, [audioRecorder]);

  useEffect(() => {
    if (!connected && connectButtonRef.current) {
      connectButtonRef.current.focus();
    }
  }, [connected]);
  
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--volume",
      `${Math.max(5, Math.min(inVolume * 200, 8))}px`,
    );
  }, [inVolume]);

  useEffect(() => {
    const onData = (base64: string) => {
      // If we're getting data from the microphone, microphone is working
      if (micStatus !== 'active') {
        setMicStatus('active');
        setMicPermissionError(null);
      }
      
      client.sendRealtimeInput([
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      ]);
    };
    
    const onVolume = (vol: number) => {
      // If we're getting volume data, microphone is working
      if (vol > 0.01 && micStatus !== 'active') {
        setMicStatus('active');
        setMicPermissionError(null);
      }
      setInVolume(vol);
    };
    
    if (connected && !muted && audioRecorder) {
      console.log("Starting audio recorder...");
      setMicStatus('inactive'); // Reset status when starting
      
      audioRecorder
        .on("data", onData)
        .on("volume", onVolume)
        .start()
        .then(() => {
          console.log("Audio recorder started successfully");
          // Don't set active here - wait for actual data or volume to confirm it's working
        })
        .catch((error) => {
          console.error("Failed to start audio recorder:", error);
          setMicStatus('error');
          setMicPermissionError(`Failed to access microphone: ${error.message}`);
        });
    } else {
      console.log("Stopping audio recorder...");
      audioRecorder.stop();
      if (connected) {
        setMicStatus(muted ? 'inactive' : 'error');
      } else {
        setMicStatus('inactive');
      }
    }
    
    return () => {
      audioRecorder.off("data", onData).off("volume", onVolume);
    };
  }, [connected, client, muted, audioRecorder, micStatus]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeVideoStream;
    }

    let timeoutId = -1;

    function sendVideoFrame() {
      const video = videoRef.current;
      const canvas = renderCanvasRef.current;

      if (!video || !canvas) {
        return;
      }

      const ctx = canvas.getContext("2d")!;
      canvas.width = video.videoWidth * 0.25;
      canvas.height = video.videoHeight * 0.25;
      if (canvas.width + canvas.height > 0) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 1.0);
        const data = base64.slice(base64.indexOf(",") + 1, Infinity);
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data }]);
      }
      if (connected) {
        timeoutId = window.setTimeout(sendVideoFrame, 1000 / 0.5);
      }
    }
    if (connected && activeVideoStream !== null) {
      requestAnimationFrame(sendVideoFrame);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [connected, activeVideoStream, client, videoRef]);

  //handler for swapping from one video-stream to the next
  const changeStreams = (next?: UseMediaStreamResult) => async () => {
    if (next) {
      const mediaStream = await next.start();
      setActiveVideoStream(mediaStream);
      onVideoStreamChange(mediaStream);
    } else {
      setActiveVideoStream(null);
      onVideoStreamChange(null);
    }

    videoStreams.filter((msr) => msr !== next).forEach((msr) => msr.stop());
  };

  return (
    <section className="control-tray">
      <canvas style={{ display: "none" }} ref={renderCanvasRef} />
      <div className="status-messages">
        {micPermissionError && (
          <div className="status-message error">
            {micPermissionError}
          </div>
        )}
        {connected && !muted && micStatus === 'inactive' && !micPermissionError && (
          <div className="status-message warning">
            Waiting for microphone input... Check browser permissions if needed.
          </div>
        )}
        {connected && !muted && micStatus === 'active' && (
          <div className="status-message success">
            Microphone active
          </div>
        )}
      </div>
      <nav className={cn("actions-nav", { disabled: !connected })}>
        <button
          className={cn("action-button mic-button", { 
            'error': micStatus === 'error' && !muted,
            'active': micStatus === 'active' && !muted
          })}
          onClick={() => setMuted(!muted)}
        >
          {!muted ? (
            <span className="material-symbols-outlined filled">mic</span>
          ) : (
            <span className="material-symbols-outlined filled">mic_off</span>
          )}
        </button>

        <div className="action-button no-action outlined">
          <AudioPulse volume={volume} active={connected} hover={false} />
        </div>

        {supportsVideo && (
          <>
            <MediaStreamButton
              isStreaming={screenCapture.isStreaming}
              start={changeStreams(screenCapture)}
              stop={changeStreams()}
              onIcon="cancel_presentation"
              offIcon="present_to_all"
            />
            <MediaStreamButton
              isStreaming={webcam.isStreaming}
              start={changeStreams(webcam)}
              stop={changeStreams()}
              onIcon="videocam_off"
              offIcon="videocam"
            />
          </>
        )}
        {children}
      </nav>
      
      <div className={cn("connection-container", { connected })}>
        <div className="connection-button-container">
          <button
            ref={connectButtonRef}
            className={cn("action-button connect-toggle", { connected })}
            onClick={handleConnect}
          >
            <span className="material-symbols-outlined filled">
              {connected ? "pause" : "play_arrow"}
            </span>
          </button>
        </div>
        <span className="text-indicator">Streaming</span>
      </div>
    </section>
  );
}

export default memo(ControlTray);

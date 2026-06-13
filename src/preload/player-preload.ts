/**
 * MusicShare — Player Preload Script
 * Phase 5 + 6.2: Secure IPC bridge for player WebContentsView,
 * plus host-side WebRTC audio capture (getDisplayMedia) and
 * RTCPeerConnection management so the player audio is streamed
 * directly to guests without capturing system audio.
 *
 * Constraints:
 * - nodeIntegration: false
 * - contextIsolation: true
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Player Message API (existing) ──

interface PlayerPreloadAPI {
  /** Send a structured message to the main process (PlayerBridge). */
  sendMessage: (msg: unknown) => void;
  /** Get the current valid Spotify access token. */
  getSpotifyToken: () => Promise<string | null>;
  /** Subscribe to Spotify access token updates. */
  onSpotifyToken: (callback: (token: string | null) => void) => () => void;
}

const playerApi: PlayerPreloadAPI = {
  sendMessage: (msg: unknown) => {
    ipcRenderer.send('player-message', msg);
  },
  getSpotifyToken: () => {
    return ipcRenderer.invoke('get-spotify-token') as Promise<string | null>;
  },
  onSpotifyToken: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string | null) => {
      callback(token);
    };
    ipcRenderer.on('spotify-token', handler);
    return () => {
      ipcRenderer.removeListener('spotify-token', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronPlayerAPI', playerApi);

// ── Host WebRTC Audio Capture ──
//
// When this client is the host in HostBroadcast mode, the player itself
// captures its own audio via getDisplayMedia (audio:true, video:false).
// This guarantees ONLY the player audio is captured, not system audio.
// The RTCPeerConnection lives inside this player process so the MediaStream
// never has to cross process boundaries.
//
// Signaling (SDP/ICE) is relayed through Main → Renderer → Socket.IO.

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** Map guest userId → RTCPeerConnection */
const guestConnections = new Map<string, RTCPeerConnection>();
let localStream: MediaStream | null = null;
let isHostMode = false;

async function ensureLocalStream(): Promise<MediaStream> {
  if (localStream && localStream.getAudioTracks().some((t) => t.readyState === 'live')) {
    return localStream;
  }
  // Capture THIS tab's audio only.  Because we are inside the player
  // WebContentsView, getDisplayMedia captures only this tab's audio output.
  localStream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: false,
  });
  console.log('[PlayerPreload] Audio capture started, tracks:', localStream.getAudioTracks().length);
  return localStream;
}

async function connectToGuest(guestUserId: string): Promise<void> {
  if (!isHostMode) return;

  if (guestConnections.has(guestUserId)) {
    console.warn('[PlayerPreload] Already connected to guest', guestUserId);
    return;
  }

  const stream = await ensureLocalStream();
  const pc = new RTCPeerConnection(STUN_SERVERS);
  guestConnections.set(guestUserId, pc);

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      guestConnections.delete(guestUserId);
      console.log('[PlayerPreload] Guest connection closed:', guestUserId);
    }
  };

  stream.getAudioTracks().forEach((track) => {
    pc.addTrack(track, stream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ipcRenderer.send('player-signaling-out', {
        type: 'ice',
        targetUserId: guestUserId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ipcRenderer.send('player-signaling-out', {
    type: 'offer',
    targetUserId: guestUserId,
    sdp: offer,
  });
}

function disconnectGuest(guestUserId: string): void {
  const pc = guestConnections.get(guestUserId);
  if (!pc) return;
  pc.close();
  guestConnections.delete(guestUserId);
}

async function handleAnswer(guestUserId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
  const pc = guestConnections.get(guestUserId);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleICECandidate(guestUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
  const pc = guestConnections.get(guestUserId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('[PlayerPreload] Failed to add ICE candidate:', err);
  }
}

function destroyHostConnections(): void {
  guestConnections.forEach((pc) => pc.close());
  guestConnections.clear();
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  isHostMode = false;
}

// Listen for signaling messages coming from SyncEngine (via Main)
ipcRenderer.on('player-signaling-in', (_event, payload: unknown) => {
  if (typeof payload !== 'object' || payload === null) return;
  const msg = payload as {
    type: string;
    targetUserId?: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };

  switch (msg.type) {
    case 'set-host-mode': {
      const enabled = (msg as any).enabled === true;
      isHostMode = enabled;
      if (!enabled) {
        destroyHostConnections();
      }
      console.log('[PlayerPreload] Host mode set to', enabled);
      break;
    }
    case 'connect': {
      if (msg.targetUserId) {
        connectToGuest(msg.targetUserId).catch((err) => {
          console.error('[PlayerPreload] connectToGuest failed:', err);
        });
      }
      break;
    }
    case 'disconnect': {
      if (msg.targetUserId) {
        disconnectGuest(msg.targetUserId);
      }
      break;
    }
    case 'answer': {
      if (msg.targetUserId && msg.sdp) {
        handleAnswer(msg.targetUserId, msg.sdp).catch((err) => {
          console.error('[PlayerPreload] handleAnswer failed:', err);
        });
      }
      break;
    }
    case 'ice': {
      if (msg.targetUserId && msg.candidate) {
        handleICECandidate(msg.targetUserId, msg.candidate).catch((err) => {
          console.error('[PlayerPreload] handleICECandidate failed:', err);
        });
      }
      break;
    }
  }
});

// ── Exposed API for Main process (via executeJavaScript) ──
//
// We expose a minimal API on window so Main can trigger host mode
// setup / teardown with executeJavaScript calls.

interface PlayerHostWebRTCAPI {
  /** Enable host mode so connectToGuest calls will succeed. */
  setHostMode: (enabled: boolean) => void;
}

const hostApi: PlayerHostWebRTCAPI = {
  setHostMode: (enabled: boolean) => {
    isHostMode = enabled;
    if (!enabled) {
      destroyHostConnections();
    }
    console.log('[PlayerPreload] Host mode set to', enabled);
  },
};

contextBridge.exposeInMainWorld('electronPlayerHostAPI', hostApi);

export {};

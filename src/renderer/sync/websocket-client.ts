/**
 * MusicShare — WebSocket Client
 * Phase 6: Socket.IO client connection, event handlers, server communication wrappers.
 */

import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  User,
  Track,
  PlayerState,
  TrackHistory,
  RoomMode,
} from '../../shared/models.js';

export class WebSocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private currentRoomId: string | null = null;

  // Callbacks set by AppUI / SyncEngine
  onRoomCreated: ((room: Room, user: User) => void) | null = null;
  onRoomJoined: ((room: Room, user: User) => void) | null = null;
  onRoomLeft: (() => void) | null = null;
  onUserJoined: ((user: User) => void) | null = null;
  onUserLeft: ((userId: string) => void) | null = null;
  onHostTransferred: ((newHostId: string) => void) | null = null;
  onQueueUpdated: ((queue: Track[]) => void) | null = null;
  onTrackAdded: ((track: Track) => void) | null = null;
  onPlayerStateUpdated: ((state: PlayerState) => void) | null = null;
  onHistoryUpdated: ((history: TrackHistory[]) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;

  // WebRTC signaling callbacks
  onSDPOffer: ((fromUserId: string, sdp: RTCSessionDescriptionInit) => void) | null = null;
  onSDPAnswer: ((fromUserId: string, sdp: RTCSessionDescriptionInit) => void) | null = null;
  onICECandidate: ((fromUserId: string, candidate: RTCIceCandidateInit) => void) | null = null;

  constructor() {
    this.connect();
  }

  connect(): void {
    this.socket = io('ws://localhost:5000', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected');
    });

    this.socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[WebSocket] Connection error:', err.message);
      this.onError?.('CONNECT_ERROR', 'サーバーに接続できません');
    });

    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    if (!this.socket) return;

    this.socket.on('RoomCreated', ({ room, user }) => {
      this.currentRoomId = room.id;
      this.onRoomCreated?.(room, user);
    });

    this.socket.on('RoomJoined', ({ room, user }) => {
      this.currentRoomId = room.id;
      this.onRoomJoined?.(room, user);
    });

    this.socket.on('RoomLeft', () => {
      this.currentRoomId = null;
      this.onRoomLeft?.();
    });

    this.socket.on('UserJoined', ({ user }) => {
      this.onUserJoined?.(user);
    });

    this.socket.on('UserLeft', ({ userId }) => {
      this.onUserLeft?.(userId);
    });

    this.socket.on('HostTransferred', ({ newHostId }) => {
      this.onHostTransferred?.(newHostId);
    });

    this.socket.on('QueueUpdated', ({ queue }) => {
      this.onQueueUpdated?.(queue);
    });

    this.socket.on('TrackAdded', ({ track }) => {
      this.onTrackAdded?.(track);
    });

    this.socket.on('PlayerStateUpdated', ({ playerState }) => {
      this.onPlayerStateUpdated?.(playerState);
    });

    this.socket.on('HistoryUpdated', ({ history }) => {
      this.onHistoryUpdated?.(history);
    });

    this.socket.on('Error', ({ code, message }) => {
      this.onError?.(code, message);
    });

    // Guest requests forwarded by server
    this.socket.on('RequestPlayPause', () => {
      // Host receives this
    });

    this.socket.on('RequestStop', () => {
      // Host receives this
    });

    // WebRTC signaling
    this.socket.on('SDPOffer', ({ fromUserId, sdp }) => {
      this.onSDPOffer?.(fromUserId, sdp);
    });

    this.socket.on('SDPAnswer', ({ fromUserId, sdp }) => {
      this.onSDPAnswer?.(fromUserId, sdp);
    });

    this.socket.on('ICECandidate', ({ fromUserId, candidate }) => {
      this.onICECandidate?.(fromUserId, candidate);
    });
  }

  // ── Client → Server emitters ──

  createRoom(roomName: string, userName: string, mode: RoomMode, maxGuests = 5): void {
    this.socket?.emit('CreateRoom', { roomName, userName, mode, maxGuests });
  }

  joinRoom(roomId: string, userName: string): void {
    this.socket?.emit('JoinRoom', { roomId, userName });
  }

  leaveRoom(): void {
    if (this.currentRoomId) {
      this.socket?.emit('LeaveRoom', { roomId: this.currentRoomId });
      this.currentRoomId = null;
    }
  }

  addTrack(track: Track): void {
    if (!this.currentRoomId) return;
    const { addedBy, ...rest } = track;
    this.socket?.emit('AddTrack', { roomId: this.currentRoomId, track: rest });
  }

  removeTrack(trackId: string): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('RemoveTrack', { roomId: this.currentRoomId, trackId });
  }

  reorderQueue(trackIds: string[]): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('ReorderQueue', { roomId: this.currentRoomId, trackIds });
  }

  updatePlayerState(playerState: PlayerState): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('UpdatePlayerState', { roomId: this.currentRoomId, playerState });
  }

  skipTrack(trackId: string): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('SkipTrack', { roomId: this.currentRoomId, trackId });
  }

  trackFinished(trackId: string): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('TrackFinished', { roomId: this.currentRoomId, trackId });
  }

  requestPlayPause(): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('RequestPlayPause', { roomId: this.currentRoomId });
  }

  requestStop(): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('RequestStop', { roomId: this.currentRoomId });
  }

  // WebRTC signaling
  sendSDPOffer(targetUserId: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('SDPOffer', { roomId: this.currentRoomId, targetUserId, sdp });
  }

  sendSDPAnswer(targetUserId: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('SDPAnswer', { roomId: this.currentRoomId, targetUserId, sdp });
  }

  sendICECandidate(targetUserId: string, candidate: RTCIceCandidateInit): void {
    if (!this.currentRoomId) return;
    this.socket?.emit('ICECandidate', { roomId: this.currentRoomId, targetUserId, candidate });
  }

  get roomId(): string | null {
    return this.currentRoomId;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }
}

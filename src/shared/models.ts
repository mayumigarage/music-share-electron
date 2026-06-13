/**
 * MusicShare — Shared Type Definitions
 * Phase 1: Core models and Socket.IO event interfaces
 */

// ============================================================================
// Enums
// ============================================================================

/** Supported music streaming services */
export enum MusicServiceType {
  YouTube = 'youtube',
  Spotify = 'spotify',
  AppleMusic = 'applemusic',
}

/** Room playback modes */
export enum RoomMode {
  /** Each user controls their own playback */
  Individual = 'Individual',
  /** Host audio is streamed to guests via WebRTC P2P */
  HostBroadcast = 'HostBroadcast',
}

// ============================================================================
// Core Interfaces
// ============================================================================

/** Represents a track in the system */
export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  /** Can be null for live streams or when duration is unknown */
  durationSeconds: number | null;
  addedBy: string; // User ID
  service: MusicServiceType;
}

/**
 * Represents the current player state.
 * Host sends this every 1 second to keep guests synchronized.
 */
export interface PlayerState {
  isPlaying: boolean;
  /** Current playback position in seconds (required) */
  positionSeconds: number;
  currentTrack: Track | null;
  /** Unix timestamp (ms) for latency calculation */
  updatedAt: number;
}

/** Represents a user in the system */
export interface User {
  id: string;
  name: string;
  isOnline: boolean;
  isHost: boolean;
}

/** Represents a track that has been played (history entry) */
export interface TrackHistory {
  track: Track;
  /** Unix timestamp (ms) */
  playedAt: number;
}

/** Spotify OAuth token set managed in main process */
export interface SpotifyTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

/** Represents a room (the core aggregation root) */
export interface Room {
  id: string;
  name: string;
  mode: RoomMode;
  hostId: string;
  users: User[];
  queue: Track[];
  history: TrackHistory[];
  playerState: PlayerState;
  /** Soft limit for guests (recommended 3–5 for Phase 1) */
  maxGuests: number;
}

// ============================================================================
// Client → Server Event Payloads
// ============================================================================

export interface CreateRoomPayload {
  roomName: string;
  userName: string;
  mode: RoomMode;
  maxGuests: number;
}

export interface JoinRoomPayload {
  roomId: string;
  userName: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface TransferHostPayload {
  roomId: string;
  newHostId: string;
}

export interface AddTrackPayload {
  roomId: string;
  track: Omit<Track, 'addedBy'>;
}

export interface RemoveTrackPayload {
  roomId: string;
  trackId: string;
}

export interface ReorderQueuePayload {
  roomId: string;
  /** New order of track IDs */
  trackIds: string[];
}

export interface UpdatePlayerStatePayload {
  roomId: string;
  playerState: PlayerState;
}

export interface SkipTrackPayload {
  roomId: string;
  trackId: string;
}

export interface TrackFinishedPayload {
  roomId: string;
  trackId: string;
}

export interface RequestPlayPausePayload {
  roomId: string;
}

export interface RequestStopPayload {
  roomId: string;
}

// WebRTC Signaling Payloads (Client → Server)
export interface SDPOfferPayload {
  roomId: string;
  targetUserId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface SDPAnswerPayload {
  roomId: string;
  targetUserId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface ICECandidatePayload {
  roomId: string;
  targetUserId: string;
  candidate: RTCIceCandidateInit;
}

export interface RequestSDPOfferPayload {
  roomId: string;
  targetUserId: string;
}

// ============================================================================
// Server → Client Event Payloads
// ============================================================================

export interface RoomCreatedPayload {
  room: Room;
  user: User;
}

export interface RoomJoinedPayload {
  room: Room;
  user: User;
}

export interface RoomLeftPayload {
  roomId: string;
  userId: string;
}

export interface HostTransferredPayload {
  roomId: string;
  newHostId: string;
}

export interface QueueUpdatedPayload {
  roomId: string;
  queue: Track[];
}

/**
 * Used for highlight UX — actual queue re-render uses QueueUpdated.
 */
export interface TrackAddedPayload {
  roomId: string;
  track: Track;
}

export interface PlayerStateUpdatedPayload {
  roomId: string;
  playerState: PlayerState;
}

export interface HistoryUpdatedPayload {
  roomId: string;
  history: TrackHistory[];
}

export interface UserJoinedPayload {
  roomId: string;
  user: User;
}

export interface UserLeftPayload {
  roomId: string;
  userId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface RequestPlayPauseServerPayload {
  roomId: string;
  requestedByUserId: string;
}

export interface RequestStopServerPayload {
  roomId: string;
  requestedByUserId: string;
}

// WebRTC Signaling Payloads (Server → Client)
export interface SDPOfferServerPayload {
  fromUserId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface SDPAnswerServerPayload {
  fromUserId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface ICECandidateServerPayload {
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}

export interface RequestSDPOfferServerPayload {
  fromUserId: string;
}

// ============================================================================
// Socket.IO Event Interfaces
// ============================================================================

/** Events emitted by the server and received by the client */
export interface ServerToClientEvents {
  RoomCreated: (payload: RoomCreatedPayload) => void;
  RoomJoined: (payload: RoomJoinedPayload) => void;
  RoomLeft: (payload: RoomLeftPayload) => void;
  HostTransferred: (payload: HostTransferredPayload) => void;
  QueueUpdated: (payload: QueueUpdatedPayload) => void;
  TrackAdded: (payload: TrackAddedPayload) => void;
  PlayerStateUpdated: (payload: PlayerStateUpdatedPayload) => void;
  HistoryUpdated: (payload: HistoryUpdatedPayload) => void;
  UserJoined: (payload: UserJoinedPayload) => void;
  UserLeft: (payload: UserLeftPayload) => void;
  Error: (payload: ErrorPayload) => void;
  RequestPlayPause: (payload: RequestPlayPauseServerPayload) => void;
  RequestStop: (payload: RequestStopServerPayload) => void;
  SDPOffer: (payload: SDPOfferServerPayload) => void;
  SDPAnswer: (payload: SDPAnswerServerPayload) => void;
  ICECandidate: (payload: ICECandidateServerPayload) => void;
  RequestSDPOffer: (payload: RequestSDPOfferServerPayload) => void;
}

/** Events emitted by the client and received by the server */
export interface ClientToServerEvents {
  CreateRoom: (payload: CreateRoomPayload) => void;
  JoinRoom: (payload: JoinRoomPayload) => void;
  LeaveRoom: (payload: LeaveRoomPayload) => void;
  TransferHost: (payload: TransferHostPayload) => void;
  AddTrack: (payload: AddTrackPayload) => void;
  RemoveTrack: (payload: RemoveTrackPayload) => void;
  ReorderQueue: (payload: ReorderQueuePayload) => void;
  UpdatePlayerState: (payload: UpdatePlayerStatePayload) => void;
  SkipTrack: (payload: SkipTrackPayload) => void;
  TrackFinished: (payload: TrackFinishedPayload) => void;
  RequestPlayPause: (payload: RequestPlayPausePayload) => void;
  RequestStop: (payload: RequestStopPayload) => void;
  SDPOffer: (payload: SDPOfferPayload) => void;
  SDPAnswer: (payload: SDPAnswerPayload) => void;
  ICECandidate: (payload: ICECandidatePayload) => void;
  RequestSDPOffer: (payload: RequestSDPOfferPayload) => void;
}

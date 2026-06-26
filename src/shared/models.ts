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
  LocalAudio = 'localaudio',
  DirectVideo = 'direct-video',
}

/** Room playback modes */
export enum RoomMode {
  /** Each user controls their own playback */
  Individual = 'Individual',
}

/** Player implementation selected when the room is created. */
export enum RoomPlayerType {
  YouTube = 'youtube',
  HtmlVideo = 'html-video',
}

// ============================================================================
// Core Interfaces
// ============================================================================

/** Represents a track in the system */
export interface Track {
  id: string;
  /** Source URL supplied by the user. Kept for service-specific UI and opening the original link. */
  url: string;
  /** YouTube/YouTube Music video selected for playback, or null for direct video URLs. */
  resolvedVideoId: string | null;
  title: string;
  artist: string;
  thumbnailUrl: string;
  /** Can be null for live streams or when duration is unknown */
  durationSeconds: number | null;
  /** Display name entered when the user created or joined the room. */
  addedBy: string;
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

/** Metadata returned by main when resolving a local audio media ID. */
export interface AudioStreamMetadata {
  title: string;
  artist: string;
  url: string;
}

/** Search result for a local audio track resolved in the main process. */
export interface LocalAudioSearchResult {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
}

/** Represents a room (the core aggregation root) */
export interface Room {
  id: string;
  name: string;
  mode: RoomMode;
  playerType: RoomPlayerType;
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
  playerType?: RoomPlayerType;
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
}

/**
 * MusicShare — Shared Type Definitions
 * Phase 1: Core models and Socket.IO event interfaces
 */
/** Supported music streaming services */
export declare enum MusicServiceType {
    YouTube = "youtube",
    Spotify = "spotify",
    AppleMusic = "applemusic",
    LocalAudio = "localaudio"
}
/** Room playback modes */
export declare enum RoomMode {
    /** Each user controls their own playback */
    Individual = "Individual",
    /** Host audio is streamed to guests via WebRTC P2P */
    HostBroadcast = "HostBroadcast"
}
/** Represents a track in the system */
export interface Track {
    id: string;
    url: string;
    resolvedVideoId: string | null;
    title: string;
    artist: string;
    thumbnailUrl: string;
    /** Can be null for live streams or when duration is unknown */
    durationSeconds: number | null;
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
    hostId: string;
    users: User[];
    queue: Track[];
    history: TrackHistory[];
    playerState: PlayerState;
    /** Soft limit for guests (recommended 3–5 for Phase 1) */
    maxGuests: number;
}
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
}
//# sourceMappingURL=models.d.ts.map

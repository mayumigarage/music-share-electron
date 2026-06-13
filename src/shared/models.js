"use strict";
/**
 * MusicShare — Shared Type Definitions
 * Phase 1: Core models and Socket.IO event interfaces
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomMode = exports.MusicServiceType = void 0;
// ============================================================================
// Enums
// ============================================================================
/** Supported music streaming services */
var MusicServiceType;
(function (MusicServiceType) {
    MusicServiceType["YouTube"] = "youtube";
    MusicServiceType["Spotify"] = "spotify";
    MusicServiceType["AppleMusic"] = "applemusic";
})(MusicServiceType || (exports.MusicServiceType = MusicServiceType = {}));
/** Room playback modes */
var RoomMode;
(function (RoomMode) {
    /** Each user controls their own playback */
    RoomMode["Individual"] = "Individual";
    /** Host audio is streamed to guests via WebRTC P2P */
    RoomMode["HostBroadcast"] = "HostBroadcast";
})(RoomMode || (exports.RoomMode = RoomMode = {}));
//# sourceMappingURL=models.js.map
/**
 * MusicShare — Room Manager
 * Phase 2: In-memory room storage, CRUD, host auto-transfer, history FIFO
 */

import {
  Room,
  User,
  Track,
  PlayerState,
  CreateRoomPayload,
} from '../shared/models';

export class RoomManager {
  private rooms = new Map<string, Room>();

  generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  createRoom(payload: CreateRoomPayload): { room: Room; user: User } {
    let id = this.generateRoomId();
    while (this.rooms.has(id)) {
      id = this.generateRoomId();
    }

    const user: User = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: payload.userName,
      isOnline: true,
      isHost: true,
    };

    const room: Room = {
      id,
      name: payload.roomName,
      mode: payload.mode,
      hostId: user.id,
      users: [user],
      queue: [],
      history: [],
      playerState: {
        isPlaying: false,
        positionSeconds: 0,
        currentTrack: null,
        updatedAt: Date.now(),
      },
      maxGuests: payload.maxGuests,
    };

    this.rooms.set(id, room);
    return { room, user };
  }

  joinRoom(
    roomId: string,
    userName: string
  ): { room: Room; user: User } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { error: 'Room not found' };
    }

    const guestCount = room.users.filter((u) => !u.isHost).length;
    if (guestCount >= room.maxGuests) {
      return { error: 'Room is full' };
    }

    const user: User = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: userName,
      isOnline: true,
      isHost: false,
    };

    room.users.push(user);
    return { room, user };
  }

  leaveRoom(
    roomId: string,
    userId: string
  ): { room: Room | null; newHostId: string | null } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { room: null, newHostId: null };
    }

    const userIndex = room.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return { room, newHostId: null };
    }

    const wasHost = room.users[userIndex].isHost;
    room.users.splice(userIndex, 1);

    let newHostId: string | null = null;

    if (room.users.length === 0) {
      this.rooms.delete(roomId);
      return { room: null, newHostId: null };
    }

    if (wasHost) {
      const nextHost = room.users.find((u) => u.isOnline) || room.users[0];
      if (nextHost) {
        nextHost.isHost = true;
        room.hostId = nextHost.id;
        newHostId = nextHost.id;
      }
    }

    return { room, newHostId };
  }

  transferHost(roomId: string, newHostId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const newHost = room.users.find((u) => u.id === newHostId);
    if (!newHost) return false;

    const currentHost = room.users.find((u) => u.isHost);
    if (currentHost) {
      currentHost.isHost = false;
    }

    newHost.isHost = true;
    room.hostId = newHostId;
    return true;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  addTrack(roomId: string, track: Track): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.queue.push(track);

    // Auto-start playback when queue was empty
    if (!room.playerState.currentTrack) {
      room.playerState.currentTrack = track;
      room.playerState.isPlaying = true;
      room.playerState.positionSeconds = 0;
      room.playerState.updatedAt = Date.now();
    }

    return true;
  }

  removeTrack(roomId: string, trackId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const index = room.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return false;
    room.queue.splice(index, 1);
    return true;
  }

  reorderQueue(roomId: string, trackIds: string[]): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const idSet = new Set(trackIds);
    const currentIds = new Set(room.queue.map((t) => t.id));
    if (
      idSet.size !== currentIds.size ||
      ![...idSet].every((id) => currentIds.has(id))
    ) {
      return false;
    }

    const trackMap = new Map(room.queue.map((t) => [t.id, t]));
    room.queue = trackIds.map((id) => trackMap.get(id)!);
    return true;
  }

  updatePlayerState(roomId: string, playerState: PlayerState): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.playerState = playerState;
    return true;
  }

  skipTrack(roomId: string, trackId: string): Track | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const index = room.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return null;

    const [track] = room.queue.splice(index, 1);
    room.history.push({ track, playedAt: Date.now() });
    if (room.history.length > 100) {
      room.history.shift();
    }

    if (room.playerState.currentTrack?.id === trackId) {
      room.playerState.currentTrack = room.queue[0] ?? null;
      room.playerState.positionSeconds = 0;
      room.playerState.isPlaying = room.playerState.currentTrack !== null;
      room.playerState.updatedAt = Date.now();
    }

    return track;
  }

  trackFinished(roomId: string, trackId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const index = room.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return false;

    const [track] = room.queue.splice(index, 1);
    room.history.push({ track, playedAt: Date.now() });
    if (room.history.length > 100) {
      room.history.shift();
    }

    room.playerState.currentTrack = room.queue[0] ?? null;
    room.playerState.positionSeconds = 0;
    room.playerState.isPlaying = room.playerState.currentTrack !== null;
    room.playerState.updatedAt = Date.now();

    return true;
  }
}

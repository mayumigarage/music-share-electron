/**
 * RoomManager unit tests
 */

import { RoomManager } from '../room-manager';
import { MusicServiceType, RoomMode, Track } from '../../shared/models';

describe('RoomManager', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  describe('createRoom', () => {
    it('creates a room with a 6-character alphanumeric ID', () => {
      const result = manager.createRoom({
        roomName: 'Test Room',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      expect(result.room.id).toHaveLength(6);
      expect(result.room.id).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(result.user.isHost).toBe(true);
      expect(result.room.hostId).toBe(result.user.id);
    });

    it('initializes empty queue and history', () => {
      const result = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      expect(result.room.queue).toEqual([]);
      expect(result.room.history).toEqual([]);
      expect(result.room.playerState.isPlaying).toBe(false);
    });
  });

  describe('joinRoom', () => {
    it('allows a user to join an existing room', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Host',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const result = manager.joinRoom(room.id, 'Guest');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.room.users).toHaveLength(2);
        expect(result.user.name).toBe('Guest');
      }
    });

    it('returns error for non-existent room', () => {
      const result = manager.joinRoom('nonexistent', 'Guest');
      expect('error' in result).toBe(true);
    });

    it('returns error when guest limit is reached', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Host',
        mode: RoomMode.Individual,
        maxGuests: 1,
      });
      manager.joinRoom(room.id, 'Guest1');
      const result = manager.joinRoom(room.id, 'Guest2');
      expect('error' in result).toBe(true);
    });
  });

  describe('leaveRoom', () => {
    it('removes user and deletes room when empty', () => {
      const { room, user } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const result = manager.leaveRoom(room.id, user.id);
      expect(result.room).toBeNull();
    });

    it('auto-transfers host when host leaves', () => {
      const { room, user: host } = manager.createRoom({
        roomName: 'Test',
        userName: 'Host',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const joinResult = manager.joinRoom(room.id, 'Guest');
      expect('error' in joinResult).toBe(false);
      const guest = ('user' in joinResult) ? joinResult.user : null;
      expect(guest).not.toBeNull();
      const result = manager.leaveRoom(room.id, host.id);
      expect(result.newHostId).toBe(guest!.id);
      expect(result.room!.hostId).toBe(guest!.id);
      expect(result.room!.users.find((u) => u.id === guest!.id)!.isHost).toBe(true);
    });

    it('keeps room intact when non-host leaves', () => {
      const { room, user: host } = manager.createRoom({
        roomName: 'Test',
        userName: 'Host',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const joinResult = manager.joinRoom(room.id, 'Guest');
      expect('error' in joinResult).toBe(false);
      const guest = ('user' in joinResult) ? joinResult.user : null;
      expect(guest).not.toBeNull();
      const result = manager.leaveRoom(room.id, guest!.id);
      expect(result.room).not.toBeNull();
      expect(result.newHostId).toBeNull();
      expect(result.room!.users).toHaveLength(1);
    });
  });

  describe('transferHost', () => {
    it('changes host to specified user', () => {
      const { room, user: host } = manager.createRoom({
        roomName: 'Test',
        userName: 'Host',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const joinResult = manager.joinRoom(room.id, 'Guest');
      expect('error' in joinResult).toBe(false);
      const guest = ('user' in joinResult) ? joinResult.user : null;
      expect(guest).not.toBeNull();
      expect(manager.transferHost(room.id, guest!.id)).toBe(true);
      const updated = manager.getRoom(room.id)!;
      expect(updated.hostId).toBe(guest!.id);
      expect(updated.users.find((u) => u.id === host.id)!.isHost).toBe(false);
      expect(updated.users.find((u) => u.id === guest!.id)!.isHost).toBe(true);
    });

    it('returns false for invalid room or user', () => {
      expect(manager.transferHost('bad-id', 'bad-user')).toBe(false);
    });
  });

  describe('queue operations', () => {
    it('adds and removes tracks', () => {
      const { room, user } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const track: Track = {
        id: 'track-1',
        url: 'https://youtube.com/watch?v=123',
        resolvedVideoId: 'dQw4w9WgXcQ',
        title: 'Song',
        artist: 'Artist',
        thumbnailUrl: '',
        durationSeconds: 180,
        addedBy: user.id,
        service: MusicServiceType.YouTube,
      };
      expect(manager.addTrack(room.id, track)).toBe(true);
      expect(manager.getRoom(room.id)!.queue).toHaveLength(1);
      expect(manager.removeTrack(room.id, 'track-1')).toBe(true);
      expect(manager.getRoom(room.id)!.queue).toHaveLength(0);
    });

    it('reorders queue', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const t1: Track = {
        id: 't1', url: '', resolvedVideoId: null, title: 'A', artist: '', thumbnailUrl: '',
        durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
      };
      const t2: Track = {
        id: 't2', url: '', resolvedVideoId: null, title: 'B', artist: '', thumbnailUrl: '',
        durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
      };
      manager.addTrack(room.id, t1);
      manager.addTrack(room.id, t2);
      expect(manager.reorderQueue(room.id, ['t2', 't1'])).toBe(true);
      expect(manager.getRoom(room.id)!.queue.map((t) => t.id)).toEqual(['t2', 't1']);
    });

    it('rejects reorder with mismatched IDs', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const t1: Track = {
        id: 't1', url: '', resolvedVideoId: null, title: 'A', artist: '', thumbnailUrl: '',
        durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
      };
      manager.addTrack(room.id, t1);
      expect(manager.reorderQueue(room.id, ['t2'])).toBe(false);
    });

    it('limits history to 100 items', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      for (let i = 0; i < 105; i++) {
        const track: Track = {
          id: `t${i}`, url: '', resolvedVideoId: null, title: '', artist: '', thumbnailUrl: '',
          durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
        };
        manager.addTrack(room.id, track);
        manager.trackFinished(room.id, `t${i}`);
      }
      expect(manager.getRoom(room.id)!.history.length).toBe(100);
      expect(manager.getRoom(room.id)!.history[0].track.id).toBe('t5');
    });
  });

  describe('player state', () => {
    it('updates player state', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const newState = {
        isPlaying: true,
        positionSeconds: 30,
        currentTrack: null,
        updatedAt: Date.now(),
      };
      expect(manager.updatePlayerState(room.id, newState)).toBe(true);
      expect(manager.getRoom(room.id)!.playerState.isPlaying).toBe(true);
    });
  });

  describe('trackFinished', () => {
    it('moves track to history and advances queue', () => {
      const { room } = manager.createRoom({
        roomName: 'Test',
        userName: 'Alice',
        mode: RoomMode.Individual,
        maxGuests: 5,
      });
      const t1: Track = {
        id: 't1', url: '', resolvedVideoId: null, title: 'A', artist: '', thumbnailUrl: '',
        durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
      };
      const t2: Track = {
        id: 't2', url: '', resolvedVideoId: null, title: 'B', artist: '', thumbnailUrl: '',
        durationSeconds: null, addedBy: 'x', service: MusicServiceType.YouTube,
      };
      manager.addTrack(room.id, t1);
      manager.addTrack(room.id, t2);
      manager.updatePlayerState(room.id, {
        isPlaying: true,
        positionSeconds: 0,
        currentTrack: t1,
        updatedAt: Date.now(),
      });

      manager.trackFinished(room.id, 't1');
      const updated = manager.getRoom(room.id)!;
      expect(updated.history).toHaveLength(1);
      expect(updated.history[0].track.id).toBe('t1');
      expect(updated.queue).toHaveLength(1);
      expect(updated.playerState.currentTrack!.id).toBe('t2');
    });
  });
});

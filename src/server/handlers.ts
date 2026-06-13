/**
 * MusicShare — Socket.IO Event Handlers
 * Phase 2: Room, queue, player, and WebRTC signaling handlers
 */

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateRoomPayload,
  JoinRoomPayload,
  LeaveRoomPayload,
  TransferHostPayload,
  AddTrackPayload,
  RemoveTrackPayload,
  ReorderQueuePayload,
  UpdatePlayerStatePayload,
  SkipTrackPayload,
  TrackFinishedPayload,
  RequestPlayPausePayload,
  RequestStopPayload,
  SDPOfferPayload,
  SDPAnswerPayload,
  ICECandidatePayload,
  RequestSDPOfferPayload,
} from '../shared/models';
import { RoomManager } from './room-manager';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketMeta {
  roomId: string;
  userId: string;
}

export function registerHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  roomManager: RoomManager
): void {
  const socketMeta = new Map<string, SocketMeta>();
  const userToSocket = new Map<string, string>();

  io.on('connection', (socket: TypedSocket) => {
    // Room management
    socket.on('CreateRoom', (payload: CreateRoomPayload) => {
      const result = roomManager.createRoom(payload);
      socket.join(result.room.id);
      socketMeta.set(socket.id, { roomId: result.room.id, userId: result.user.id });
      userToSocket.set(result.user.id, socket.id);
      socket.emit('RoomCreated', { room: result.room, user: result.user });
    });

    socket.on('JoinRoom', (payload: JoinRoomPayload) => {
      const result = roomManager.joinRoom(payload.roomId, payload.userName);
      if ('error' in result) {
        socket.emit('Error', { code: 'JOIN_FAILED', message: result.error });
        return;
      }
      socket.join(result.room.id);
      socketMeta.set(socket.id, { roomId: result.room.id, userId: result.user.id });
      userToSocket.set(result.user.id, socket.id);
      socket.emit('RoomJoined', { room: result.room, user: result.user });
      socket.to(result.room.id).emit('UserJoined', { roomId: result.room.id, user: result.user });
    });

    socket.on('LeaveRoom', (payload: LeaveRoomPayload) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.roomId !== payload.roomId) return;

      const { room, newHostId } = roomManager.leaveRoom(meta.roomId, meta.userId);
      socket.leave(meta.roomId);
      userToSocket.delete(meta.userId);
      socketMeta.delete(socket.id);

      if (room) {
        io.to(meta.roomId).emit('UserLeft', { roomId: meta.roomId, userId: meta.userId });
        if (newHostId) {
          io.to(meta.roomId).emit('HostTransferred', { roomId: meta.roomId, newHostId });
        }
      }
    });

    socket.on('TransferHost', (payload: TransferHostPayload) => {
      const success = roomManager.transferHost(payload.roomId, payload.newHostId);
      if (success) {
        io.to(payload.roomId).emit('HostTransferred', {
          roomId: payload.roomId,
          newHostId: payload.newHostId,
        });
      }
    });

    // Queue management
    socket.on('AddTrack', (payload: AddTrackPayload) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      const track = {
        ...payload.track,
        addedBy: meta.userId,
      };
      const success = roomManager.addTrack(meta.roomId, track);
      if (!success) return;

      const room = roomManager.getRoom(meta.roomId);
      if (!room) return;

      // If auto-started, broadcast the new player state to everyone including sender
      if (room.playerState.currentTrack?.id === track.id) {
        io.to(meta.roomId).emit('PlayerStateUpdated', {
          roomId: meta.roomId,
          playerState: room.playerState,
        });
      }

      io.to(meta.roomId).emit('QueueUpdated', { roomId: meta.roomId, queue: room.queue });
      io.to(meta.roomId).emit('TrackAdded', { roomId: meta.roomId, track });
    });

    socket.on('RemoveTrack', (payload: RemoveTrackPayload) => {
      const success = roomManager.removeTrack(payload.roomId, payload.trackId);
      if (!success) return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      io.to(payload.roomId).emit('QueueUpdated', { roomId: payload.roomId, queue: room.queue });
    });

    socket.on('ReorderQueue', (payload: ReorderQueuePayload) => {
      const success = roomManager.reorderQueue(payload.roomId, payload.trackIds);
      if (!success) return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      io.to(payload.roomId).emit('QueueUpdated', { roomId: payload.roomId, queue: room.queue });
    });

    // Player state
    socket.on('UpdatePlayerState', (payload: UpdatePlayerStatePayload) => {
      const success = roomManager.updatePlayerState(payload.roomId, payload.playerState);
      if (!success) return;

      socket.to(payload.roomId).emit('PlayerStateUpdated', {
        roomId: payload.roomId,
        playerState: payload.playerState,
      });
    });

    socket.on('SkipTrack', (payload: SkipTrackPayload) => {
      const track = roomManager.skipTrack(payload.roomId, payload.trackId);
      if (!track) return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      io.to(payload.roomId).emit('QueueUpdated', { roomId: payload.roomId, queue: room.queue });
      io.to(payload.roomId).emit('HistoryUpdated', {
        roomId: payload.roomId,
        history: room.history,
      });
      io.to(payload.roomId).emit('PlayerStateUpdated', {
        roomId: payload.roomId,
        playerState: room.playerState,
      });
    });

    socket.on('TrackFinished', (payload: TrackFinishedPayload) => {
      const success = roomManager.trackFinished(payload.roomId, payload.trackId);
      if (!success) return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      io.to(payload.roomId).emit('QueueUpdated', { roomId: payload.roomId, queue: room.queue });
      io.to(payload.roomId).emit('HistoryUpdated', {
        roomId: payload.roomId,
        history: room.history,
      });
      io.to(payload.roomId).emit('PlayerStateUpdated', {
        roomId: payload.roomId,
        playerState: room.playerState,
      });
    });

    // Guest requests
    socket.on('RequestPlayPause', (payload: RequestPlayPausePayload) => {
      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      const hostSocketId = userToSocket.get(room.hostId);
      if (hostSocketId) {
        io.to(hostSocketId).emit('RequestPlayPause', {
          roomId: payload.roomId,
          requestedByUserId: meta.userId,
        });
      }
    });

    socket.on('RequestStop', (payload: RequestStopPayload) => {
      const room = roomManager.getRoom(payload.roomId);
      if (!room) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      const hostSocketId = userToSocket.get(room.hostId);
      if (hostSocketId) {
        io.to(hostSocketId).emit('RequestStop', {
          roomId: payload.roomId,
          requestedByUserId: meta.userId,
        });
      }
    });

    // WebRTC signaling
    socket.on('SDPOffer', (payload: SDPOfferPayload) => {
      const targetSocketId = userToSocket.get(payload.targetUserId);
      if (!targetSocketId) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      io.to(targetSocketId).emit('SDPOffer', {
        fromUserId: meta.userId,
        sdp: payload.sdp,
      });
    });

    socket.on('SDPAnswer', (payload: SDPAnswerPayload) => {
      const targetSocketId = userToSocket.get(payload.targetUserId);
      if (!targetSocketId) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      io.to(targetSocketId).emit('SDPAnswer', {
        fromUserId: meta.userId,
        sdp: payload.sdp,
      });
    });

    socket.on('ICECandidate', (payload: ICECandidatePayload) => {
      const targetSocketId = userToSocket.get(payload.targetUserId);
      if (!targetSocketId) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      io.to(targetSocketId).emit('ICECandidate', {
        fromUserId: meta.userId,
        candidate: payload.candidate,
      });
    });

    socket.on('RequestSDPOffer', (payload: RequestSDPOfferPayload) => {
      const targetSocketId = userToSocket.get(payload.targetUserId);
      if (!targetSocketId) return;

      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      io.to(targetSocketId).emit('RequestSDPOffer', {
        fromUserId: meta.userId,
      });
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      const { room, newHostId } = roomManager.leaveRoom(meta.roomId, meta.userId);
      userToSocket.delete(meta.userId);
      socketMeta.delete(socket.id);

      if (room) {
        io.to(meta.roomId).emit('UserLeft', { roomId: meta.roomId, userId: meta.userId });
        if (newHostId) {
          io.to(meta.roomId).emit('HostTransferred', { roomId: meta.roomId, newHostId });
        }
      }
    });
  });
}

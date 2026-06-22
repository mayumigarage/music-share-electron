/**
 * Socket.IO handlers integration tests
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { RoomManager } from '../room-manager';
import { registerHandlers } from '../handlers';
import { RoomMode, MusicServiceType } from '../../shared/models';

describe('Socket.IO Handlers', () => {
  let ioServer: Server;
  let httpServer: ReturnType<typeof createServer>;
  let roomManager: RoomManager;
  let clientSocket: ClientSocket;
  let port: number;

  beforeAll((done) => {
    httpServer = createServer();
    ioServer = new Server(httpServer);
    roomManager = new RoomManager();
    registerHandlers(ioServer, roomManager);
    httpServer.listen(() => {
      port = (httpServer.address() as { port: number }).port;
      clientSocket = Client(`http://localhost:${port}`);
      clientSocket.on('connect', done);
    });
  });

  afterAll(() => {
    ioServer.close();
    httpServer.close();
    clientSocket.close();
  });

  it('handles CreateRoom and emits RoomCreated', (done) => {
    clientSocket.once('RoomCreated', (payload) => {
      expect(payload.room.name).toBe('Test Room');
      expect(payload.user.name).toBe('Alice');
      expect(payload.user.isHost).toBe(true);
      done();
    });

    clientSocket.emit('CreateRoom', {
      roomName: 'Test Room',
      userName: 'Alice',
      mode: RoomMode.Individual,
      maxGuests: 5,
    });
  });

  it('handles JoinRoom and emits RoomJoined', (done) => {
    const { room } = roomManager.createRoom({
      roomName: 'Host Room',
      userName: 'Host',
      mode: RoomMode.Individual,
      maxGuests: 5,
    });

    clientSocket.once('RoomJoined', (payload) => {
      expect(payload.room.id).toBe(room.id);
      expect(payload.user.name).toBe('Bob');
      done();
    });

    clientSocket.emit('JoinRoom', { roomId: room.id, userName: 'Bob' });
  });

  it('broadcasts UserJoined to existing members', (done) => {
    const { room } = roomManager.createRoom({
      roomName: 'Host Room',
      userName: 'Host',
      mode: RoomMode.Individual,
      maxGuests: 5,
    });

    const client2 = Client(`http://localhost:${port}`);

    client2.on('connect', () => {
      client2.once('RoomJoined', () => {
        client2.once('UserJoined', (payload) => {
          expect(payload.user.name).toBe('Bob');
          client2.close();
          done();
        });

        clientSocket.emit('JoinRoom', { roomId: room.id, userName: 'Bob' });
      });

      client2.emit('JoinRoom', { roomId: room.id, userName: 'Existing' });
    });
  });

  it('handles AddTrack and broadcasts QueueUpdated + TrackAdded', (done) => {
    clientSocket.once('RoomCreated', (payload) => {
      const roomId = payload.room.id;

      clientSocket.once('TrackAdded', (trackPayload) => {
        expect(trackPayload.track.title).toBe('My Song');
        expect(trackPayload.track.addedBy).toBe('Alice');
        done();
      });

      clientSocket.emit('AddTrack', {
        roomId,
        track: {
          id: 'track-1',
          url: 'https://youtube.com/watch?v=123',
          title: 'My Song',
          artist: 'Artist',
          thumbnailUrl: '',
          durationSeconds: 180,
          service: MusicServiceType.YouTube,
        },
      });
    });

    clientSocket.emit('CreateRoom', {
      roomName: 'Track Test',
      userName: 'Alice',
      mode: RoomMode.Individual,
      maxGuests: 5,
    });
  });

  it('handles disconnect and cleans up', (done) => {
    clientSocket.once('RoomCreated', (payload) => {
      const roomId = payload.room.id;

      const client2 = Client(`http://localhost:${port}`);
      client2.on('connect', () => {
        client2.emit('JoinRoom', { roomId, userName: 'Bob' });
      });

      client2.once('RoomJoined', () => {
        clientSocket.once('UserLeft', (leftPayload) => {
          expect(leftPayload.roomId).toBe(roomId);
          client2.close();
          done();
        });
        client2.close();
      });
    });

    clientSocket.emit('CreateRoom', {
      roomName: 'DC Room',
      userName: 'Alice',
      mode: RoomMode.Individual,
      maxGuests: 5,
    });
  });
});

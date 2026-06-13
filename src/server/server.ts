/**
 * MusicShare — Socket.IO Server Entry Point
 * Phase 2: Bootstrap typed Socket.IO server on port 5000
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '../shared/models';
import { RoomManager } from './room-manager';
import { registerHandlers } from './handlers';

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager();
registerHandlers(io, roomManager);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

httpServer.listen(PORT, () => {
  console.log(`MusicShare server listening on port ${PORT}`);
});

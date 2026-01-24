const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const GameManager = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // SECURITY: In production, restrict this to your specific domain(s)
    // e.g., origin: 'https://yourgame.com' or ['https://yourgame.com', 'https://www.yourgame.com']
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
});

// Serve static files from client folder
app.use(express.static('client'));

// Serve shared folder for constants and utilities used by both client and server
app.use('/shared', express.static('shared'));

// Initialize game manager
const gameManager = new GameManager(io);

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Note: 'join-error' is used for room creation/joining errors (handled by lobby UI)
  // 'error' is used for all other game-related errors
  socket.on('create-room', (data) => {
    try {
      gameManager.createRoom(socket, data);
    } catch (e) {
      console.error('Error in create-room:', e);
      socket.emit('join-error', { message: 'Server error' });
    }
  });

  socket.on('join-room', (data) => {
    try {
      gameManager.joinRoom(socket, data);
    } catch (e) {
      console.error('Error in join-room:', e);
      socket.emit('join-error', { message: 'Server error' });
    }
  });

  socket.on('toggle-ready', () => {
    try {
      gameManager.toggleReady(socket);
    } catch (err) {
      console.error('[Server] Error in toggle-ready:', err);
      socket.emit('error', { message: 'Failed to toggle ready status' });
    }
  });

  socket.on('kick-player', (data) => {
    try {
      gameManager.kickPlayer(socket, data);
    } catch (err) {
      console.error('[Server] Error in kick-player:', err);
      socket.emit('error', { message: 'Failed to kick player' });
    }
  });

  socket.on('update-settings', (data) => {
    try {
      gameManager.updateSettings(socket, data);
    } catch (err) {
      console.error('[Server] Error in update-settings:', err);
      socket.emit('error', { message: 'Failed to update settings' });
    }
  });

  socket.on('start-game', () => {
    try {
      gameManager.startGame(socket);
    } catch (e) {
      console.error('Error in start-game:', e);
      // Use 'error' for game-related errors (not join-related)
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  socket.on('input', (data) => {
    try {
      gameManager.handleInput(socket, data);
    } catch (e) {
      console.error('[Server] Error in input:', e);
      socket.emit('error', { message: 'Input processing failed' });
    }
  });

  socket.on('pause', () => {
    try {
      gameManager.pauseGame(socket);
    } catch (err) {
      console.error('[Server] Error in pause:', err);
      socket.emit('error', { message: 'Failed to pause game' });
    }
  });

  socket.on('resume', () => {
    try {
      gameManager.resumeGame(socket);
    } catch (err) {
      console.error('[Server] Error in resume:', err);
      socket.emit('error', { message: 'Failed to resume game' });
    }
  });

  socket.on('quit', () => {
    try {
      gameManager.quitGame(socket);
    } catch (err) {
      console.error('[Server] Error in quit:', err);
      socket.emit('error', { message: 'Failed to quit game' });
    }
  });

  socket.on('return-lobby', () => {
    try {
      gameManager.returnToLobby(socket);
    } catch (err) {
      console.error('[Server] Error in return-lobby:', err);
      socket.emit('error', { message: 'Failed to return to lobby' });
    }
  });

  socket.on('disconnect', () => {
    try {
      gameManager.handleDisconnect(socket);
    } catch (e) {
      console.error('Error in disconnect:', e);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LIGHTS OUT server running on port ${PORT}`);
});

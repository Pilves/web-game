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
    origin: process.env.CORS_ORIGIN || '*'
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
    } catch (e) {
      console.error('Error in toggle-ready:', e);
    }
  });

  socket.on('kick-player', (data) => {
    try {
      gameManager.kickPlayer(socket, data);
    } catch (e) {
      console.error('Error in kick-player:', e);
    }
  });

  socket.on('update-settings', (data) => {
    try {
      gameManager.updateSettings(socket, data);
    } catch (e) {
      console.error('Error in update-settings:', e);
    }
  });

  socket.on('start-game', () => {
    try {
      gameManager.startGame(socket);
    } catch (e) {
      console.error('Error in start-game:', e);
      socket.emit('join-error', { message: 'Server error' });
    }
  });

  socket.on('input', (data) => {
    try {
      gameManager.handleInput(socket, data);
    } catch (e) {
      console.error('Error in input:', e);
    }
  });

  socket.on('pause', () => {
    try {
      gameManager.pauseGame(socket);
    } catch (e) {
      console.error('Error in pause:', e);
    }
  });

  socket.on('resume', () => {
    try {
      gameManager.resumeGame(socket);
    } catch (e) {
      console.error('Error in resume:', e);
    }
  });

  socket.on('quit', () => {
    try {
      gameManager.quitGame(socket);
    } catch (e) {
      console.error('Error in quit:', e);
    }
  });

  socket.on('return-lobby', () => {
    try {
      gameManager.returnToLobby(socket);
    } catch (e) {
      console.error('Error in return-lobby:', e);
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

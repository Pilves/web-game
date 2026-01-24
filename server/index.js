const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const GameManager = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Serve static files from client folder
app.use(express.static('client'));

// Initialize game manager
const gameManager = new GameManager(io);

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('create-room', (data) => gameManager.createRoom(socket, data));
  socket.on('join-room', (data) => gameManager.joinRoom(socket, data));
  socket.on('toggle-ready', () => gameManager.toggleReady(socket));
  socket.on('kick-player', (data) => gameManager.kickPlayer(socket, data));
  socket.on('update-settings', (data) => gameManager.updateSettings(socket, data));
  socket.on('start-game', () => gameManager.startGame(socket));
  socket.on('input', (data) => gameManager.handleInput(socket, data));
  socket.on('pause', () => gameManager.pauseGame(socket));
  socket.on('resume', () => gameManager.resumeGame(socket));
  socket.on('quit', () => gameManager.quitGame(socket));
  socket.on('return-lobby', () => gameManager.returnToLobby(socket));
  socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LIGHTS OUT server running on port ${PORT}`);
});

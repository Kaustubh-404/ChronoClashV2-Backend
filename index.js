const express = require('express');
const http = require('http');
const cors = require('cors');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Import controllers
const { 
  handleUserConnection,
  handleUserDisconnection, 
  handleCreateRoom, 
  handleJoinRoom,
  handleLeaveRoom,
  handleCharacterSelect,
  handlePlayerReady,
  handleGameAction,
  handleChatMessage
} = require('./controllers/gameController');

// Import game state manager
const GameStateManager = require('./models/GameStateManager');

// Initialize the app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? 'https://chronoclash.yourdomain.com' 
      : 'http://localhost:3000',
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize game state manager
const gameState = new GameStateManager();

// REST API routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '1.0.0' });
});

app.get('/api/rooms', (req, res) => {
  const rooms = gameState.getPublicRooms();
  res.status(200).json({ rooms });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = gameState.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.status(200).json({ room });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Register the user connection
  handleUserConnection(socket, gameState);
  
  // Handle room creation
  socket.on('create_room', (data) => handleCreateRoom(socket, data, gameState, io));
  
  // Handle room joining
  socket.on('join_room', (data) => handleJoinRoom(socket, data, gameState, io));
  
  // Handle room leaving
  socket.on('leave_room', (data) => handleLeaveRoom(socket, data, gameState, io));
  
  // Handle character selection
  socket.on('select_character', (data) => handleCharacterSelect(socket, data, gameState, io));
  
  // Handle player ready status
  socket.on('player_ready', (data) => handlePlayerReady(socket, data, gameState, io));
  
  // Handle game actions (abilities, attacks, etc.)
  socket.on('game_action', (data) => handleGameAction(socket, data, gameState, io));
  
  // Handle in-game chat messages
  socket.on('chat_message', (data) => handleChatMessage(socket, data, io));
  
  // Handle disconnection
  socket.on('disconnect', () => handleUserDisconnection(socket, gameState, io));
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Chrono Clash server running on port ${PORT}`);
});

module.exports = { app, server }; // For testing purposes
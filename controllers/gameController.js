/**
 * Game Controller
 * Handles all game-related socket events
 */

/**
 * Handle new user connection
 * @param {object} socket - Socket.IO socket object
 * @param {object} gameState - Game state manager instance
 */
function handleUserConnection(socket, gameState) {
  // Default player data
  const playerData = {
    name: `Player_${socket.id.substring(0, 5)}`,
    isConnected: true
  };
  
  // Register the player
  gameState.registerPlayer(socket.id, playerData);
  
  // Send confirmation to the player
  socket.emit('connection_success', { 
    playerId: socket.id,
    playerData: gameState.getPlayer(socket.id)
  });
}

/**
 * Handle user disconnection
 * @param {object} socket - Socket.IO socket object
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleUserDisconnection(socket, gameState, io) {
  console.log(`User disconnected: ${socket.id}`);
  
  // Check if player was in a room
  if (gameState.playerToRoom.has(socket.id)) {
    const roomId = gameState.playerToRoom.get(socket.id);
    const room = gameState.getRoom(roomId);
    
    if (room) {
      // Notify other players in the room
      socket.to(roomId).emit('player_left', {
        playerId: socket.id,
        playerName: gameState.getPlayer(socket.id)?.name || 'Unknown Player'
      });
      
      // Remove player from room
      const result = gameState.removePlayerFromRoom(socket.id, roomId);
      
      // If room still exists, update room data for remaining players
      if (!result.roomClosed && result.room) {
        io.to(roomId).emit('room_updated', { room: result.room });
      }
    }
  }
  
  // Unregister the player
  gameState.unregisterPlayer(socket.id);
}

/**
 * Handle room creation
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Room data
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleCreateRoom(socket, data, gameState, io) {
  console.log(`Creating room for ${socket.id}`);
  
  // Create the room
  const room = gameState.createRoom(socket.id, {
    name: data.name,
    isPrivate: data.isPrivate
  });
  
  if (!room) {
    socket.emit('create_room_error', { error: 'Failed to create room' });
    return;
  }
  
  // Join the socket to the room for room-specific broadcasts
  socket.join(room.id);
  
  // Send room data to the host
  socket.emit('room_created', { room });
  
  // Broadcast new room to all connected clients (for room listings)
  if (!room.isPrivate) {
    socket.broadcast.emit('room_available', {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      hostName: gameState.getPlayer(room.hostId)?.name || 'Unknown Host',
      players: room.players.length,
      maxPlayers: room.maxPlayers,
      createdAt: room.createdAt
    });
  }
}

/**
 * Handle room joining
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Join data with roomId
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleJoinRoom(socket, data, gameState, io) {
  console.log(`${socket.id} trying to join room ${data.roomId}`);
  
  // Try to add player to the room
  const result = gameState.addPlayerToRoom(socket.id, data.roomId);
  
  if (!result.success) {
    socket.emit('join_room_error', { error: result.error });
    return;
  }
  
  // Join the socket to the room for room-specific broadcasts
  socket.join(data.roomId);
  
  // Get player data
  const player = gameState.getPlayer(socket.id);
  
  // Notify all players in the room about the new player
  io.to(data.roomId).emit('player_joined', {
    roomId: data.roomId,
    player: {
      id: player.id,
      name: player.name,
      character: player.character,
      isReady: player.isReady
    }
  });
  
  // Send room data to the joining player
  socket.emit('room_joined', { room: result.room });
  
  // If this was the last available slot, remove the room from listings
  if (result.room.players.length >= result.room.maxPlayers) {
    io.emit('room_unavailable', { roomId: data.roomId });
  }
}

/**
 * Handle room leaving
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Room data
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleLeaveRoom(socket, data, gameState, io) {
  console.log(`${socket.id} leaving room ${data.roomId}`);
  
  // Verify player is in the specified room
  const currentRoomId = gameState.playerToRoom.get(socket.id);
  if (currentRoomId !== data.roomId) {
    socket.emit('leave_room_error', { error: 'You are not in this room' });
    return;
  }
  
  // Get player data before leaving
  const player = gameState.getPlayer(socket.id);
  const playerName = player ? player.name : 'Unknown Player';
  
  // Remove player from room
  const result = gameState.removePlayerFromRoom(socket.id, data.roomId);
  
  // Leave the socket room
  socket.leave(data.roomId);
  
  // Acknowledge the leave
  socket.emit('room_left', { roomId: data.roomId });
  
  if (!result.success) {
    return;
  }
  
  // If room still exists, update remaining players
  if (!result.roomClosed && result.room) {
    // Notify other players in the room
    io.to(data.roomId).emit('player_left', {
      playerId: socket.id,
      playerName
    });
    
    // Update room data for remaining players
    io.to(data.roomId).emit('room_updated', { room: result.room });
    
    // If a slot opened up in a public room, broadcast its availability
    if (!result.room.isPrivate && result.room.players.length < result.room.maxPlayers) {
      io.emit('room_available', {
        id: result.room.id,
        name: result.room.name,
        hostId: result.room.hostId,
        hostName: gameState.getPlayer(result.room.hostId)?.name || 'Unknown Host',
        players: result.room.players.length,
        maxPlayers: result.room.maxPlayers,
        createdAt: result.room.createdAt
      });
    }
  }
}

/**
 * Handle character selection
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Character data
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleCharacterSelect(socket, data, gameState, io) {
  console.log(`${socket.id} selecting character: ${data.character.id}`);
  
  // Get room player is in
  const roomId = gameState.playerToRoom.get(socket.id);
  if (!roomId) {
    socket.emit('character_select_error', { error: 'You are not in a room' });
    return;
  }

  // Set the character
  const result = gameState.setPlayerCharacter(socket.id, data.character);
  
  if (!result.success) {
    socket.emit('character_select_error', { error: result.error });
    return;
  }
  
  // Get updated player data
  const player = gameState.getPlayer(socket.id);
  
  // Notify all players in the room
  io.to(roomId).emit('character_selected', {
    playerId: socket.id,
    playerName: player.name,
    character: {
      id: player.character.id,
      name: player.character.name,
      avatar: player.character.avatar,
      health: player.health,
      maxHealth: player.maxHealth,
      mana: player.mana,
      maxMana: player.maxMana
      // Don't send the full abilities data to avoid cheating
    }
  });
}

/**
 * Handle player ready status
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Ready status data
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handlePlayerReady(socket, data, gameState, io) {
  console.log(`${socket.id} setting ready: ${data.isReady}`);
  
  // Get room player is in
  const roomId = gameState.playerToRoom.get(socket.id);
  if (!roomId) {
    socket.emit('player_ready_error', { error: 'You are not in a room' });
    return;
  }
  
  // Ensure player has selected a character
  const player = gameState.getPlayer(socket.id);
  if (!player.character) {
    socket.emit('player_ready_error', { error: 'You must select a character first' });
    return;
  }
  
  // Set player ready status
  const result = gameState.setPlayerReady(socket.id, data.isReady);
  
  if (!result.success) {
    socket.emit('player_ready_error', { error: result.error });
    return;
  }
  
  // Notify all players in the room
  io.to(roomId).emit('player_ready_updated', {
    playerId: socket.id,
    playerName: player.name,
    isReady: data.isReady
  });
  
  // If all players are ready, start game countdown
  if (result.allReady) {
    io.to(roomId).emit('game_countdown', { countdown: 3 });
    
    // Start the game after countdown
    setTimeout(() => {
      const gameResult = gameState.startGame(roomId);
      
      if (gameResult.success) {
        io.to(roomId).emit('game_started', { 
          room: gameResult.room,
          gameData: gameResult.room.gameData
        });
      }
    }, 3000);
  }
}

/**
 * Handle game actions
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Action data
 * @param {object} gameState - Game state manager instance
 * @param {object} io - Socket.IO server instance
 */
function handleGameAction(socket, data, gameState, io) {
  console.log(`${socket.id} performing action: ${data.type}`);
  
  // Get room player is in
  const roomId = gameState.playerToRoom.get(socket.id);
  if (!roomId) {
    socket.emit('game_action_error', { error: 'You are not in a room' });
    return;
  }
  
  // Process the action
  const result = gameState.processGameAction(socket.id, data);
  
  if (!result.success) {
    socket.emit('game_action_error', { error: result.error });
    return;
  }
  
  // Get the room
  const room = result.room;
  
  // Notify all players of the action
  io.to(roomId).emit('game_action_performed', {
    playerId: socket.id,
    action: data,
    result: {
      // Include only necessary info to avoid sending all game state
      ability: result.ability ? {
        id: result.ability.id,
        name: result.ability.name,
        type: result.ability.type
      } : null,
      damage: result.damage,
      actingPlayerId: socket.id,
      targetPlayerId: socket.id === room.hostId ? room.guestId : room.hostId,
      actingPlayerHealth: result.actingPlayer.health,
      actingPlayerMana: result.actingPlayer.mana,
      targetPlayerHealth: result.targetPlayer.health,
      surrender: result.surrender || false
    },
    gameData: {
      turnCount: room.gameData.turnCount,
      currentTurn: room.gameData.currentTurn,
      battleLog: room.gameData.battleLog.slice(-3) // Just send the last few log entries
    }
  });
  
  // If the game is over, send game over notification
  if (result.gameOver) {
    io.to(roomId).emit('game_over', {
      winnerId: result.winner,
      winnerName: gameState.getPlayer(result.winner)?.name || 'Unknown Player',
      gameData: room.gameData
    });
  }
}

/**
 * Handle chat messages
 * @param {object} socket - Socket.IO socket object
 * @param {object} data - Message data
 * @param {object} io - Socket.IO server instance
 */
function handleChatMessage(socket, data, io) {
  // Get room player is in
  const roomId = data.roomId;
  
  // Validate message
  if (!data.message || typeof data.message !== 'string' || data.message.trim() === '') {
    return; // Ignore empty messages
  }
  
  // Get player data
  const player = gameState.getPlayer(socket.id);
  if (!player) return;
  
  // Create message object
  const message = {
    id: Date.now().toString(),
    playerId: socket.id,
    playerName: player.name,
    message: data.message.trim().substring(0, 500), // Limit message length
    timestamp: Date.now()
  };
  
  // Broadcast message to room
  io.to(roomId).emit('chat_message', message);
}

module.exports = {
  handleUserConnection,
  handleUserDisconnection,
  handleCreateRoom,
  handleJoinRoom,
  handleLeaveRoom,
  handleCharacterSelect,
  handlePlayerReady,
  handleGameAction,
  handleChatMessage
};
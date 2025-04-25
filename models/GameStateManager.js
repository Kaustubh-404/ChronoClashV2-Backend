/**
 * GameStateManager - Manages all game state including rooms, players, and battles
 */
class GameStateManager {
    constructor() {
      this.rooms = new Map(); // roomId -> roomData
      this.players = new Map(); // socketId -> playerData
      this.playerToRoom = new Map(); // socketId -> roomId
    }
  
    /**
     * Register a new player
     * @param {string} socketId - Socket ID of the player
     * @param {object} playerData - Player information
     */
    registerPlayer(socketId, playerData) {
      this.players.set(socketId, {
        id: socketId,
        name: playerData.name || `Player_${socketId.substring(0, 5)}`,
        isConnected: true,
        character: null,
        isReady: false,
        health: 0,
        maxHealth: 0,
        mana: 0,
        maxMana: 0,
        lastActive: Date.now()
      });
      return this.players.get(socketId);
    }
  
    /**
     * Unregister a player
     * @param {string} socketId - Socket ID of the player
     */
    unregisterPlayer(socketId) {
      // If player is in a room, handle leaving
      if (this.playerToRoom.has(socketId)) {
        const roomId = this.playerToRoom.get(socketId);
        this.removePlayerFromRoom(socketId, roomId);
      }
      
      this.players.delete(socketId);
      this.playerToRoom.delete(socketId);
    }
  
    /**
     * Get player data
     * @param {string} socketId - Socket ID of the player
     */
    getPlayer(socketId) {
      return this.players.get(socketId);
    }
  
    /**
     * Update player data
     * @param {string} socketId - Socket ID of the player
     * @param {object} updates - Data to update
     */
    updatePlayer(socketId, updates) {
      const player = this.players.get(socketId);
      if (!player) return null;
      
      Object.assign(player, updates);
      player.lastActive = Date.now();
      return player;
    }
  
    /**
     * Create a new game room
     * @param {string} hostId - Socket ID of the host
     * @param {object} roomData - Room configuration
     */
    createRoom(hostId, roomData = {}) {
      // Generate a 6-character room code
      const roomId = roomData.roomId || this.generateRoomCode();
      
      // Ensure this host isn't already hosting another room
      this.leaveAllRooms(hostId);
      
      // Get host player data
      const host = this.players.get(hostId);
      if (!host) return null;
      
      // Create the room
      const room = {
        id: roomId,
        name: roomData.name || `${host.name}'s Room`,
        hostId: hostId,
        guestId: null,
        status: 'waiting', // waiting, ready, in-progress, completed
        isPrivate: roomData.isPrivate || false,
        maxPlayers: 2, // For now, only 2-player games are supported
        players: [hostId],
        spectators: [],
        gameData: {
          turnCount: 0,
          currentTurn: null,
          battleLog: [],
          startTime: null,
          endTime: null,
          winner: null
        },
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      // Register the room
      this.rooms.set(roomId, room);
      this.playerToRoom.set(hostId, roomId);
      
      return room;
    }
  
    /**
     * Generate a unique room code
     */
    generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar-looking characters
      let code;
      
      // Keep generating until we find an unused code
      do {
        code = '';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      } while (this.rooms.has(code));
      
      return code;
    }
  
    /**
     * Get a specific room
     * @param {string} roomId - Room ID
     */
    getRoom(roomId) {
      return this.rooms.get(roomId);
    }
  
    /**
     * Get all public rooms
     */
    getPublicRooms() {
      const publicRooms = [];
      this.rooms.forEach(room => {
        if (!room.isPrivate && room.status === 'waiting' && room.players.length < room.maxPlayers) {
          // Only include non-private, waiting rooms with available slots
          publicRooms.push({
            id: room.id,
            name: room.name,
            hostId: room.hostId,
            hostName: this.players.get(room.hostId)?.name || 'Unknown Host',
            players: room.players.length,
            maxPlayers: room.maxPlayers,
            createdAt: room.createdAt
          });
        }
      });
      return publicRooms;
    }
  
    /**
     * Add a player to a room
     * @param {string} socketId - Socket ID of the player
     * @param {string} roomId - Room ID
     */
    addPlayerToRoom(socketId, roomId) {
      // Make sure room exists
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Make sure player exists
      const player = this.players.get(socketId);
      if (!player) return { success: false, error: 'Player not found' };
      
      // Check if room is full
      if (room.players.length >= room.maxPlayers) {
        return { success: false, error: 'Room is full' };
      }
      
      // Check if room is in an incompatible state
      if (room.status !== 'waiting') {
        return { success: false, error: 'Room is not accepting new players' };
      }
      
      // Remove player from any other rooms
      this.leaveAllRooms(socketId);
      
      // Add player to the room
      room.players.push(socketId);
      this.playerToRoom.set(socketId, roomId);
      
      // If this is the second player, they're the guest
      if (room.players.length === 2) {
        room.guestId = socketId;
      }
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, room };
    }
  
    /**
     * Remove a player from a room
     * @param {string} socketId - Socket ID of the player
     * @param {string} roomId - Room ID
     */
    removePlayerFromRoom(socketId, roomId) {
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Remove player from room
      room.players = room.players.filter(id => id !== socketId);
      this.playerToRoom.delete(socketId);
      
      // Update room state if needed
      if (socketId === room.hostId) {
        // Host left, either transfer host or close the room
        if (room.players.length > 0) {
          // Transfer host to the next player
          room.hostId = room.players[0];
          if (room.guestId === room.hostId) {
            room.guestId = null; // Clear guest status if they're now host
          }
        } else {
          // No players left, delete the room
          this.rooms.delete(roomId);
          return { success: true, roomClosed: true };
        }
      }
      
      // If this was the guest, clear guest ID
      if (socketId === room.guestId) {
        room.guestId = null;
      }
      
      // If game was in progress, end it
      if (room.status === 'in-progress') {
        room.status = 'completed';
        room.gameData.endTime = Date.now();
        room.gameData.winner = room.players[0]; // Remaining player wins by default
      }
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, room };
    }
  
    /**
     * Remove a player from all rooms they're in
     * @param {string} socketId - Socket ID of the player
     */
    leaveAllRooms(socketId) {
      // Check if player is in any room
      if (this.playerToRoom.has(socketId)) {
        const roomId = this.playerToRoom.get(socketId);
        return this.removePlayerFromRoom(socketId, roomId);
      }
      return { success: true, noRoomFound: true };
    }
  
    /**
     * Set player's character
     * @param {string} socketId - Socket ID of the player
     * @param {object} character - Character data
     */
    setPlayerCharacter(socketId, character) {
      // Update player data
      const player = this.updatePlayer(socketId, { 
        character,
        health: character.health,
        maxHealth: character.health,
        mana: character.mana,
        maxMana: character.mana,
        isReady: false // Reset ready status when changing character
      });
      if (!player) return { success: false, error: 'Player not found' };
      
      // Get the room player is in
      const roomId = this.playerToRoom.get(socketId);
      if (!roomId) return { success: false, error: 'Player not in a room' };
      
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, player, room };
    }
  
    /**
     * Set player's ready status
     * @param {string} socketId - Socket ID of the player
     * @param {boolean} isReady - Ready status
     */
    setPlayerReady(socketId, isReady) {
      // Update player data
      const player = this.updatePlayer(socketId, { isReady });
      if (!player) return { success: false, error: 'Player not found' };
      
      // Get the room player is in
      const roomId = this.playerToRoom.get(socketId);
      if (!roomId) return { success: false, error: 'Player not in a room' };
      
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Check if all players are ready
      const allReady = room.players.length === 2 && 
                      room.players.every(id => this.players.get(id).isReady);
      
      // Update room status if all ready
      if (allReady && room.status === 'waiting') {
        room.status = 'ready';
      }
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, player, room, allReady };
    }
  
    /**
     * Start a game
     * @param {string} roomId - Room ID
     */
    startGame(roomId) {
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Verify room is in a state to start
      if (room.status !== 'ready') {
        return { success: false, error: 'Not all players are ready' };
      }
      
      if (room.players.length !== 2) {
        return { success: false, error: 'Need exactly 2 players to start' };
      }
      
      // Set initial game state
      room.status = 'in-progress';
      room.gameData = {
        turnCount: 1,
        currentTurn: room.hostId, // Host goes first
        battleLog: ['Battle started!', `${this.players.get(room.hostId).name} goes first!`],
        startTime: Date.now(),
        endTime: null,
        winner: null
      };
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, room };
    }
  
    /**
     * Process a game action
     * @param {string} socketId - Socket ID of the acting player
     * @param {object} action - Action data
     */
    processGameAction(socketId, action) {
      // Get the room the player is in
      const roomId = this.playerToRoom.get(socketId);
      if (!roomId) return { success: false, error: 'Player not in a room' };
      
      const room = this.rooms.get(roomId);
      if (!room) return { success: false, error: 'Room not found' };
      
      // Verify game is in progress
      if (room.status !== 'in-progress') {
        return { success: false, error: 'Game is not in progress' };
      }
      
      // Verify it's the player's turn
      if (room.gameData.currentTurn !== socketId) {
        return { success: false, error: 'Not your turn' };
      }
      
      // Get both players
      const actingPlayer = this.players.get(socketId);
      const targetPlayer = this.players.get(
        socketId === room.hostId ? room.guestId : room.hostId
      );
      
      if (!actingPlayer || !targetPlayer) {
        return { success: false, error: 'Player data missing' };
      }
      
      // Process the action based on type
      let result = {};
      switch (action.type) {
        case 'ability':
          result = this.processAbilityUse(actingPlayer, targetPlayer, action, room);
          break;
        case 'surrender':
          result = this.processSurrender(actingPlayer, targetPlayer, room);
          break;
        default:
          return { success: false, error: 'Unknown action type' };
      }
      
      // Check for game over
      if (actingPlayer.health <= 0 || targetPlayer.health <= 0) {
        const winner = actingPlayer.health <= 0 ? targetPlayer.id : actingPlayer.id;
        room.status = 'completed';
        room.gameData.endTime = Date.now();
        room.gameData.winner = winner;
        
        // Add game over message to battle log
        const winnerName = this.players.get(winner).name;
        room.gameData.battleLog.push(`${winnerName} wins the battle!`);
        
        result.gameOver = true;
        result.winner = winner;
      } else {
        // Advance to next turn if game not over
        room.gameData.currentTurn = room.gameData.currentTurn === room.hostId ? room.guestId : room.hostId;
        room.gameData.turnCount++;
        
        // Add turn change message to battle log
        const nextPlayerName = this.players.get(room.gameData.currentTurn).name;
        room.gameData.battleLog.push(`${nextPlayerName}'s turn!`);
      }
      
      // Update room activity timestamp
      room.lastActivity = Date.now();
      
      return { success: true, ...result, room };
    }
  
    /**
     * Process an ability use action
     * @param {object} actingPlayer - Player using the ability
     * @param {object} targetPlayer - Target player
     * @param {object} action - Action data
     * @param {object} room - Room data
     */
    processAbilityUse(actingPlayer, targetPlayer, action, room) {
      // Verify player has this ability
      const ability = actingPlayer.character?.abilities.find(a => a.id === action.abilityId);
      if (!ability) {
        return { success: false, error: 'Ability not found' };
      }
      
      // Check mana cost
      if (actingPlayer.mana < ability.manaCost) {
        return { success: false, error: 'Not enough mana' };
      }
      
      // Apply mana cost
      actingPlayer.mana = Math.max(0, actingPlayer.mana - ability.manaCost);
      
      // Calculate damage
      let damage = ability.damage;
      
      // Apply damage to target
      targetPlayer.health = Math.max(0, targetPlayer.health - damage);
      
      // Add to battle log
      room.gameData.battleLog.push(`${actingPlayer.name} used ${ability.name}!`);
      room.gameData.battleLog.push(`${targetPlayer.name} took ${damage} damage!`);
      
      return { 
        success: true, 
        ability, 
        damage,
        actingPlayer,
        targetPlayer
      };
    }
  
    /**
     * Process a surrender action
     * @param {object} actingPlayer - Player surrendering
     * @param {object} targetPlayer - Opponent player
     * @param {object} room - Room data
     */
    processSurrender(actingPlayer, targetPlayer, room) {
      // Set surrendering player's health to 0
      actingPlayer.health = 0;
      
      // Add to battle log
      room.gameData.battleLog.push(`${actingPlayer.name} surrendered!`);
      
      return { 
        success: true,
        surrender: true,
        actingPlayer,
        targetPlayer
      };
    }
  
    /**
     * Clean up inactive rooms and players
     * @param {number} roomTimeout - Milliseconds after which to close inactive rooms
     * @param {number} playerTimeout - Milliseconds after which to remove inactive players
     */
    cleanupInactive(roomTimeout = 30 * 60 * 1000, playerTimeout = 60 * 60 * 1000) {
      const now = Date.now();
      
      // Clean up inactive rooms
      this.rooms.forEach((room, roomId) => {
        if (now - room.lastActivity > roomTimeout) {
          // Notify all players in the room
          room.players.forEach(playerId => {
            this.playerToRoom.delete(playerId);
          });
          
          // Delete the room
          this.rooms.delete(roomId);
        }
      });
      
      // Clean up inactive players
      this.players.forEach((player, playerId) => {
        if (now - player.lastActive > playerTimeout && !this.playerToRoom.has(playerId)) {
          // Only remove players who aren't in a room
          this.players.delete(playerId);
        }
      });
    }
  }
  
  module.exports = GameStateManager;
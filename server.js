const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const playerName = data.name || `Jogador_${roomId}`;
    
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      gameStarted: false,
      players: {}
    };

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 0,
      y: 0,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players });
    console.log(`Sala criada: ${roomId} por ${playerName}`);
  });

  socket.on('join_room', (data) => {
    const roomId = data.roomId ? data.roomId.toUpperCase() : '';
    
    if (!rooms[roomId]) return socket.emit('error_message', 'Sala não encontrada.');
    if (rooms[roomId].gameStarted) return socket.emit('error_message', 'A partida já começou.');

    const playerName = data.name || `Jogador_${Math.floor(Math.random() * 1000)}`;

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 0,
      y: 0,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
    console.log(`Jogador ${playerName} entrou na sala ${roomId}`);
  });

  socket.on('player_move', (data) => {
    const roomId = data.roomId;
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      const updatedData = {
        id: socket.id,
        name: rooms[roomId].players[socket.id].name, // Mantém o nome original do server
        x: data.x,
        y: data.y,
        direction: data.direction,
        animation: data.animation,
        appearance: data.appearance,
        currentVehicle: data.currentVehicle,
        currentWeapon: data.currentWeapon
      };

      rooms[roomId].players[socket.id] = updatedData;
      socket.to(roomId).emit('player_moved', updatedData);
    }
  });

  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].players && rooms[roomId].players[socket.id]) {
        const leftPlayerName = rooms[roomId].players[socket.id].name;
        delete rooms[roomId].players[socket.id];
        
        if (Object.keys(rooms[roomId].players).length === 0) {
          console.log(`Sala ${roomId} vazia.`);
        } else {
          if (rooms[roomId].host === socket.id) {
            rooms[roomId].host = Object.keys(rooms[roomId].players)[0];
          }
          io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
        }
        console.log(`Jogador ${leftPlayerName} desconectou.`);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexões do Netlify e do Lovable
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Armazenamento em memória das salas e jogadores
const rooms = {};

io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  // 1. CRIAR SALA
  socket.on('create_room', (data) => {
    // Gera código de 5 dígitos alfanuméricos
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      gameStarted: false,
      players: {}
    };

    // Adiciona o criador da sala
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: data.name || `Jogador_${roomId}`,
      x: 0,
      y: 0,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players });
    console.log(`Sala criada: ${roomId} por ${socket.id}`);
  });

  // 2. ENTRAR NA SALA
  socket.on('join_room', (data) => {
    const roomId = data.roomId ? data.roomId.toUpperCase() : '';
    
    if (!rooms[roomId]) {
      return socket.emit('error_message', 'Sala não encontrada.');
    }
    if (rooms[roomId].gameStarted) {
      return socket.emit('error_message', 'A partida já começou.');
    }

    // Adiciona o novo jogador
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: data.name || `Jogador_${Math.floor(Math.random() * 1000)}`,
      x: 0,
      y: 0,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    
    // Atualiza todo mundo na sala sobre o novo estado
    io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
    console.log(`Jogador ${socket.id} entrou na sala ${roomId}`);
  });

  // 3. INICIAR PARTIDA
  socket.on('start_game', (data) => {
    const roomId = data.roomId;
    if (rooms[roomId] && rooms[roomId].host === socket.id) {
      rooms[roomId].gameStarted = true;
      io.to(roomId).emit('game_started');
    }
  });

  // 4. SINCRONIZAR MOVIMENTO E ESTADO COMPLETO
  socket.on('player_move', (data) => {
    const roomId = data.roomId;
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      // Atualiza os dados completos do jogador no servidor
      rooms[roomId].players[socket.id] = {
        ...rooms[roomId].players[socket.id],
        x: data.x,
        y: data.y,
        direction: data.direction,
        animation: data.animation,
        // Novos dados adicionados para visualização de terceiros:
        name: data.name || rooms[roomId].players[socket.id].name,
        appearance: data.appearance, // Ex: ID da skin ou cor
        currentVehicle: data.currentVehicle, // Ex: ID do carro ou nulo
        currentWeapon: data.currentWeapon // Ex: ID da arma equipada
      };

      // Transmite a atualização com o estado visual completo para os outros jogadores da sala
      socket.to(roomId).emit('player_moved', rooms[roomId].players[socket.id]);
    }
  });

  // 5. DESCONEXÃO
  socket.on('disconnect', () => {
    console.log(`Usuário desconectado: ${socket.id}`);
    
    // Procura em qual sala o jogador estava para removê-lo
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].players && rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        
        // Se a sala ficou vazia, ela NÃO é deletada (mantém histórico em memória)
        if (Object.keys(rooms[roomId].players).length === 0) {
          console.log(`Sala ${roomId} ficou vazia, mas mantida no histórico.`);
        } else {
          // Se o host saiu, passa o host para o próximo jogador da lista
          if (rooms[roomId].host === socket.id) {
            rooms[roomId].host = Object.keys(rooms[roomId].players)[0];
          }
          // Notifica os sobreviventes da sala
          io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor de TrapLife rodando na porta ${PORT}`);
});

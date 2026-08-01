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

  // 1. CRIAR SALA (MUNDO ABERTO)
  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const playerName = data.name || `Jogador_${roomId}`;
    
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      gameStarted: true, // Já nasce ativa como mundo aberto
      players: {}
    };

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 300,
      y: 300,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players });
    socket.emit('game_started'); // Manda o criador direto para o mapa
    console.log(`Sala criada e aberta: ${roomId} por ${playerName}`);
  });

  // 2. ENTRAR NA SALA (MUNDO ABERTO)
  socket.on('join_room', (data) => {
    const roomId = data.roomId ? data.roomId.toUpperCase() : '';
    
    if (!rooms[roomId]) return socket.emit('error_message', 'Sala não encontrada.');

    const playerName = data.name || `Jogador_${Math.floor(Math.random() * 1000)}`;

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 300, // Coordenada inicial padrão para todos nascerem juntos
      y: 300,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    
    // Força o jogador que acabou de entrar a ir direto pro mapa sem telas de travas
    socket.emit('game_started'); 
    
    // Sincroniza o novo estado da sala para todos os presentes
    io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
    console.log(`Jogador ${playerName} entrou direto no mundo da sala ${roomId}`);
  });

  // 3. SINCRONIZAR MOVIMENTO E ESTADO COMPLETO
  socket.on('player_move', (data) => {
    const roomId = data.roomId;
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      const updatedData = {
        id: socket.id,
        name: rooms[roomId].players[socket.id].name, // Preserva o nickname correto criado na entrada
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

  // 4. DESCONEXÃO E LIMPEZA DA SALA
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].players && rooms[roomId].players[socket.id]) {
        const leftPlayerName = rooms[roomId].players[socket.id].name;
        delete rooms[roomId].players[socket.id];
        
        if (Object.keys(rooms[roomId].players).length === 0) {
          console.log(`Sala ${roomId} ficou vazia, mas guardada no histórico.`);
        } else {
          // Se o criador sair da sala ativa, repassa a liderança técnica para o próximo player online
          if (rooms[roomId].host === socket.id) {
            rooms[roomId].host = Object.keys(rooms[roomId].players)[0];
          }
          // Notifica os jogadores restantes sobre quem saiu
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

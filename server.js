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
    // Garante que o código gerado ou enviado não venha com espaços ocultos
    const roomId = (data.roomId || Math.random().toString(36).substring(2, 7)).trim().toUpperCase();
    const playerName = data.name || `Jogador_${roomId}`;
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        host: socket.id,
        gameStarted: true,
        players: {}
      };
    }

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
    socket.emit('game_started'); 
    console.log(`[SUCESSO] Sala criada/registrada no servidor: ${roomId} por ${playerName}`);
  });

  // 2. ENTRAR NA SALA (MUNDO ABERTO - BLINDADO CONTRA ISOLAMENTO)
  socket.on('join_room', (data) => {
    if (!data.roomId) return socket.emit('error_message', 'Código inválido.');
    
    // Força o código digitado a ficar limpo e em letras maiúsculas idêntico ao servidor
    const roomId = data.roomId.trim().toUpperCase();
    const playerName = data.name || `Jogador_${Math.floor(Math.random() * 1000)}`;

    // SE A SALA NÃO EXISTIR (POR RESET DE MEMÓRIA DO RENDER), CRIAMOS ELA AGORA EM VEZ DE REJEITAR!
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        host: socket.id,
        gameStarted: true,
        players: {}
      };
      console.log(`[AVISO] Sala ${roomId} não estava na memória. Criando nova instância dinâmica.`);
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 300, 
      y: 300,
      direction: 'down',
      animation: 'idle'
    };

    socket.join(roomId);
    socket.emit('game_started'); 
    
    // Dispara para absolutamente todo mundo conectado no mesmo canal de ID
    io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
    console.log(`[SUCESSO] Jogador ${playerName} acoplado na sala compartilhada: ${roomId}`);
  });

  // 3. SINCRONIZAR MOVIMENTO E ESTADO COMPLETO
  socket.on('player_move', (data) => {
    // Limpa a string do roomId recebida do movimento para garantir o canal correto
    const roomId = data.roomId ? data.roomId.trim().toUpperCase() : null;
    
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      const updatedData = {
        id: socket.id,
        name: rooms[roomId].players[socket.id].name, 
        x: data.x,
        y: data.y,
        direction: data.direction,
        animation: data.animation,
        appearance: data.appearance,
        currentVehicle: data.currentVehicle,
        currentWeapon: data.currentWeapon
      };

      rooms[roomId].players[socket.id] = updatedData;
      // Envia somente para os outros da mesma sala limpa
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
          console.log(`Sala ${roomId} ficou vazia temporariamente.`);
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

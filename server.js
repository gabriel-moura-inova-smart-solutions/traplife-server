const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true }
});

const rooms = {};

// Função para inicializar elementos do mundo quando uma sala é criada
function initializeWorldState(roomId) {
  rooms[roomId].world = {
    time: "12:00",
    weather: "sunny",
    // Lista de veículos globais no mapa (ID, tipo, posição, se tem motorista/carona)
    vehicles: {
      "car_01": { id: "car_01", type: "sedan", x: 500, y: 500, driver: null, passenger: null },
      "plane_01": { id: "plane_01", type: "airplane", x: 1200, y: 300, driver: null, passenger: null }
    },
    // NPCs sincronizados
    npcs: {
      "npc_01": { id: "npc_01", type: "civilian", x: 400, y: 450, color: "blue", health: 100 },
      "npc_02": { id: "npc_02", type: "civilian", x: 600, y: 450, color: "red", health: 100 }
    },
    // Viaturas e Policiais ativos na sala
    police: {}
  };
}

io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  // 1. CRIAR SALA
  socket.on('create_room', (data) => {
    const roomId = (data.roomId || Math.random().toString(36).substring(2, 7)).trim().toUpperCase();
    const playerName = data.name || `Jogador_${roomId}`;
    
    if (!rooms[roomId]) {
      rooms[roomId] = { id: roomId, host: socket.id, gameStarted: true, players: {} };
      initializeWorldState(roomId);
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id, name: playerName, x: 300, y: 300,
      direction: 'down', animation: 'idle', vehicleId: null, seat: null
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, players: rooms[roomId].players });
    socket.emit('world_update', rooms[roomId].world); // Envia o mundo inicializado
    socket.emit('game_started'); 
  });

  // 2. ENTRAR NA SALA
  socket.on('join_room', (data) => {
    if (!data.roomId) return socket.emit('error_message', 'Código inválido.');
    const roomId = data.roomId.trim().toUpperCase();
    const playerName = data.name || `Jogador_${Math.floor(Math.random() * 1000)}`;

    if (!rooms[roomId]) {
      rooms[roomId] = { id: roomId, host: socket.id, gameStarted: true, players: {} };
      initializeWorldState(roomId);
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id, name: playerName, x: 300, y: 300,
      direction: 'down', animation: 'idle', vehicleId: null, seat: null
    };

    socket.join(roomId);
    socket.emit('game_started'); 
    socket.emit('world_update', rooms[roomId].world); // Envia o mundo atual para o novato
    
    io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
  });

  // 3. MOVIMENTO E ATUALIZAÇÃO DO JOGADOR
  socket.on('player_move', (data) => {
    const roomId = data.roomId ? data.roomId.trim().toUpperCase() : null;
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      
      // Atualiza os dados do player
      rooms[roomId].players[socket.id] = {
        ...rooms[roomId].players[socket.id],
        x: data.x, y: data.y, direction: data.direction, animation: data.animation
      };

      // Se o jogador estiver dirigindo um veículo do mapa, atualiza a posição do veículo no mundo real
      const vId = rooms[roomId].players[socket.id].vehicleId;
      if (vId && rooms[roomId].world.vehicles[vId] && rooms[roomId].players[socket.id].seat === 'driver') {
        rooms[roomId].world.vehicles[vId].x = data.x;
        rooms[roomId].world.vehicles[vId].y = data.y;
        
        // Transmite o movimento do veículo para todos na sala
        socket.to(roomId).emit('vehicle_moved', { vehicleId: vId, x: data.x, y: data.y });
      }

      socket.to(roomId).emit('player_moved', rooms[roomId].players[socket.id]);
    }
  });

  // 4. ENTRAR EM VEÍCULO (PILOTO OU CARONA)
  socket.on('action_enter_vehicle', (data) => {
    const roomId = data.roomId?.trim().toUpperCase();
    const vId = data.vehicleId;
    if (rooms[roomId] && rooms[roomId].world.vehicles[vId]) {
      const vehicle = rooms[roomId].world.vehicles[vId];
      let assignedSeat = null;

      if (!vehicle.driver) {
        vehicle.driver = socket.id;
        assignedSeat = 'driver';
      } else if (!vehicle.passenger) {
        vehicle.passenger = socket.id;
        assignedSeat = 'passenger';
      }

      if (assignedSeat) {
        rooms[roomId].players[socket.id].vehicleId = vId;
        rooms[roomId].players[socket.id].seat = assignedSeat;
        
        // Avisa a sala inteira quem entrou no carro e em qual assento
        io.to(roomId).emit('player_entered_vehicle', {
          playerId: socket.id, vehicleId: vId, seat: assignedSeat, worldVehicles: rooms[roomId].world.vehicles
        });
      }
    }
  });

  // 5. SAIR DO VEÍCULO
  socket.on('action_exit_vehicle', (data) => {
    const roomId = data.roomId?.trim().toUpperCase();
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      const vId = rooms[roomId].players[socket.id].vehicleId;
      if (vId && rooms[roomId].world.vehicles[vId]) {
        const vehicle = rooms[roomId].world.vehicles[vId];
        
        if (vehicle.driver === socket.id) vehicle.driver = null;
        if (vehicle.passenger === socket.id) vehicle.passenger = null;

        rooms[roomId].players[socket.id].vehicleId = null;
        rooms[roomId].players[socket.id].seat = null;

        io.to(roomId).emit('player_left_vehicle', {
          playerId: socket.id, vehicleId: vId, worldVehicles: rooms[roomId].world.vehicles
        });
      }
    }
  });

  // 6. SINCRONIZAR POLÍCIA / PERSEGUIÇÃO
  socket.on('police_spawn', (data) => {
    const roomId = data.roomId?.trim().toUpperCase();
    if (rooms[roomId]) {
      const copId = `cop_${Math.random().toString(36).substring(2, 5)}`;
      rooms[roomId].world.police[copId] = { id: copId, x: data.x, y: data.y, targetId: socket.id };
      io.to(roomId).emit('police_updated', rooms[roomId].world.police);
    }
  });

  // DESCONEXÃO
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].players && rooms[roomId].players[socket.id]) {
        const vId = rooms[roomId].players[socket.id].vehicleId;
        if (vId && rooms[roomId].world.vehicles[vId]) {
          if (rooms[roomId].world.vehicles[vId].driver === socket.id) rooms[roomId].world.vehicles[vId].driver = null;
          if (rooms[roomId].world.vehicles[vId].passenger === socket.id) rooms[roomId].world.vehicles[vId].passenger = null;
        }
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('room_state', { roomId, players: rooms[roomId].players });
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor de Mundo Aberto rodando na porta ${PORT}`));

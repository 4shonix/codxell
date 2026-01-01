import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';

dotenv.config();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow WebSocket connections
}));

app.use(cors());

// Rate limiting for HTTP endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 20000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e7, // 50MB
  cors: {
    origin: "*", // Allow all origins for simplicity in dev
    methods: ["GET", "POST"]
  }
});

// State
let waitingQueue = []; // Array of socket objects
const activeRooms = new Map(); // socketId -> roomId
const publicKeys = new Map(); // socketId -> publicKey (for E2E encryption)
const messageCounts = new Map(); // socketId -> { count, resetTime } for rate limiting

// Rate limiting for socket messages
const MESSAGE_RATE_LIMIT = 10; // messages per second
const RATE_WINDOW = 1000; // 1 second

function checkMessageRateLimit(socketId) {
  const now = Date.now();
  const record = messageCounts.get(socketId);

  if (!record || now > record.resetTime) {
    messageCounts.set(socketId, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= MESSAGE_RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Input validation helper
function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') return 'Anonymous';
  // Remove any HTML/script tags and limit length
  const sanitized = validator.escape(username.trim());
  return sanitized.substring(0, 50) || 'Anonymous';
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_queue', (data) => {
    const { username, profilePic } = data || {};
    socket.data.username = sanitizeUsername(username);
    socket.data.profilePic = profilePic;

    // If user is already in an active room, don't allow joining queue
    if (activeRooms.has(socket.id)) {
      console.log(`User ${socket.id} tried to join queue while in active room`);
      return;
    }

    // If user is already in queue, don't add again
    if (waitingQueue.find(s => s.id === socket.id)) {
      console.log(`User ${socket.id} already in queue`);
      return;
    }

    if (waitingQueue.length > 0) {
      const partnerSocket = waitingQueue.shift();
      const roomId = `room_${socket.id}_${partnerSocket.id}`;

      socket.join(roomId);
      partnerSocket.join(roomId);

      activeRooms.set(socket.id, roomId);
      activeRooms.set(partnerSocket.id, roomId);

      // Emit chat_start with partner names and profile pics
      io.to(socket.id).emit('chat_start', {
        roomId,
        partnerName: partnerSocket.data.username,
        partnerProfilePic: partnerSocket.data.profilePic
      });
      io.to(partnerSocket.id).emit('chat_start', {
        roomId,
        partnerName: socket.data.username,
        partnerProfilePic: socket.data.profilePic
      });

      console.log(`Matched ${socket.id} (${socket.data.username}) with ${partnerSocket.id} (${partnerSocket.data.username}) in ${roomId}`);
    } else {
      waitingQueue.push(socket);
      console.log(`User ${socket.id} (${socket.data.username}) added to queue`);
    }
  });

  // Key exchange for E2E encryption
  socket.on('exchange_keys', (data) => {
    const { publicKey } = data;
    if (publicKey && typeof publicKey === 'string') {
      publicKeys.set(socket.id, publicKey);

      // Send public key to partner if in a room
      const roomId = activeRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit('partner_public_key', { publicKey });
      }
    }
  });

  socket.on('send_message', (data) => {
    // Rate limiting
    if (!checkMessageRateLimit(socket.id)) {
      socket.emit('rate_limit_exceeded', { message: 'Sending messages too fast. Please slow down.' });
      return;
    }

    const { roomId, text, sender, type, fileContent, fileType, id, replyTo, encrypted } = data;
    socket.to(roomId).emit('receive_message', {
      text,
      sender: 'other',
      id: id || Date.now(),
      type: type || 'text',
      fileContent,
      fileType,
      replyTo,
      encrypted // Pass through encrypted data
    });
  });

  socket.on('typing', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('typing');
  });

  socket.on('stop_typing', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('stop_typing');
  });

  socket.on('edit_message', (data) => {
    const { roomId, id, text } = data;
    socket.to(roomId).emit('message_edited', { id, text });
  });

  socket.on('delete_message', (data) => {
    const { roomId, id } = data;
    socket.to(roomId).emit('message_deleted', { id });
  });

  socket.on('skip', () => {
    const roomId = activeRooms.get(socket.id);
    if (roomId) {
      // Find partner's socket ID from the room
      const partnerId = Array.from(activeRooms.entries())
        .find(([id, room]) => room === roomId && id !== socket.id)?.[0];

      // Notify partner
      socket.to(roomId).emit('partner_disconnected');

      // Clean up both sides
      socket.leave(roomId);
      activeRooms.delete(socket.id);

      if (partnerId) {
        activeRooms.delete(partnerId);
        console.log(`Cleaned up room ${roomId} for both ${socket.id} and ${partnerId}`);
      }
    }

    // Remove from queue if they were waiting
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    console.log(`User ${socket.id} skipped, removed from room and queue`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove from queue
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    // Clean up encryption keys
    publicKeys.delete(socket.id);
    messageCounts.delete(socket.id);

    // Notify partner if in room and clean up both sides
    const roomId = activeRooms.get(socket.id);
    if (roomId) {
      // Find partner's socket ID from the room
      const partnerId = Array.from(activeRooms.entries())
        .find(([id, room]) => room === roomId && id !== socket.id)?.[0];

      // Notify partner
      socket.to(roomId).emit('partner_disconnected');

      // Clean up both sides
      activeRooms.delete(socket.id);

      if (partnerId) {
        activeRooms.delete(partnerId);
        publicKeys.delete(partnerId);
        console.log(`User ${socket.id} disconnected, cleaned up room ${roomId} for both users`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.js';
import boardRoutes from './routes/boards.js';
const app = express();
const server = createServer(app);
const prisma = new PrismaClient();
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
    origin: corsOrigins,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
// Health check
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
// Asset routes
app.post('/api/assets', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const { kind, url, pageCount } = req.body;
        if (!kind || !url) {
            return res.status(400).json({ error: 'Missing required fields: kind, url' });
        }
        const asset = await prisma.asset.create({
            data: {
                ownerId: user.id,
                kind,
                url,
                pageCount: pageCount || null
            }
        });
        return res.status(201).json(asset);
    }
    catch (error) {
        console.error('Asset creation error:', error);
        return res.status(500).json({ error: 'Failed to create asset' });
    }
});
// Log registered endpoints (dev only)
if (process.env.NODE_ENV !== 'production') {
    console.log('Registered routes:');
    console.log('- /api/auth/*');
    console.log('- /api/boards/*');
    console.log('- /health');
}
// Socket.IO setup
const io = new Server(server, {
    path: '/ws',
    cors: {
        origin: corsOrigins,
        credentials: true
    }
});
// Socket.IO middleware for authentication
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        const shareToken = socket.handshake.auth.shareToken;
        const boardId = socket.handshake.auth.boardId;
        const pageId = socket.handshake.auth.pageId;
        if (!boardId) {
            return next(new Error('Board ID required'));
        }
        let canEdit = false;
        let userId;
        let userName;
        if (token) {
            const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId }
            });
            if (!user) {
                return next(new Error('User not found'));
            }
            userId = user.id;
            userName = user.name || user.email;
            // Check board permissions
            const board = await prisma.board.findUnique({
                where: { id: boardId },
                include: { memberships: true }
            });
            if (!board) {
                return next(new Error('Board not found'));
            }
            const isOwner = board.ownerId === userId;
            const membership = board.memberships.find((m) => m.userId === userId);
            const membershipRole = membership?.role;
            canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
        }
        else if (shareToken) {
            const shareLink = await prisma.shareLink.findUnique({
                where: { token: shareToken },
                include: { board: true }
            });
            if (!shareLink || shareLink.boardId !== boardId) {
                return next(new Error('Invalid share token'));
            }
            canEdit = shareLink.canEdit;
            userName = 'Anonymous User';
        }
        else {
            return next(new Error('Authentication required'));
        }
        socket.data = { userId, boardId, pageId, canEdit, userName };
        socket.join(`board:${boardId}`);
        if (pageId) {
            socket.join(`page:${pageId}`);
        }
        console.log('socket auth', { boardId, pageId, canEdit });
        next();
    }
    catch (error) {
        next(new Error('Authentication failed'));
    }
});
// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.data.userName);
    // Handle page switching
    socket.on('page:switch', async (data) => {
        const { boardId, pageId } = data;
        // Verify access to board
        if (socket.data.boardId !== boardId) {
            socket.emit('error', 'Access denied');
            return;
        }
        // Leave old page room if any
        if (socket.data.pageId) {
            socket.leave(`page:${socket.data.pageId}`);
        }
        // Join new page room
        socket.data.pageId = pageId;
        socket.join(`page:${pageId}`);
        console.log(`User ${socket.data.userName} switched to page ${pageId}`);
    });
    // Handle shape events (add/update/delete) - now page-scoped
    const handleShapeEvent = async (eventName, data) => {
        const { boardId, pageId } = data;
        // Enforce write permissions for mutating events
        if (!socket.data.canEdit) {
            socket.emit('error', 'Edit permission denied');
            return;
        }
        // Verify page access
        if (!pageId) {
            socket.emit('error', 'Page ID required');
            return;
        }
        // Store event in database with page scope
        await prisma.boardEvent.create({
            data: {
                boardId,
                pageId,
                type: eventName,
                payload: data
            }
        });
        // Broadcast to page room except sender to avoid loops
        socket.to(`page:${pageId}`).emit(eventName, data);
    };
    socket.on('shape:add', (data) => handleShapeEvent('shape:add', data));
    socket.on('shape:update', (data) => handleShapeEvent('shape:update', data));
    socket.on('shape:delete', (data) => handleShapeEvent('shape:delete', data));
    // Handle presence cursor (page-scoped)
    socket.on('presence:cursor', (data) => {
        const { pageId } = data;
        if (!pageId)
            return; // Skip if no page context
        // Broadcast cursor position to other users in the page
        socket.to(`page:${pageId}`).emit('presence:cursor', {
            ...data,
            socketId: socket.id,
            userName: socket.data.userName
        });
    });
    // Page settings update
    socket.on('page:settings:update', async (data) => {
        const { pageId } = data;
        if (!socket.data.canEdit) {
            socket.emit('error', 'Edit permission denied');
            return;
        }
        if (!pageId) {
            socket.emit('error', 'Page ID required');
            return;
        }
        // Broadcast to page room
        socket.to(`page:${pageId}`).emit('page:settings:update', data);
    });
    // Board-level events (asset uploads, etc.)
    socket.on('asset:add', async (data) => {
        const { boardId } = data;
        if (!socket.data.canEdit) {
            socket.emit('error', 'Edit permission denied');
            return;
        }
        // Broadcast to entire board
        socket.to(`board:${boardId}`).emit('asset:add', data);
    });
    // Legacy support (can be removed later)
    socket.on('canvas-event', async (data) => {
        const { boardId, pageId, event } = data;
        if (!socket.data.canEdit) {
            socket.emit('error', 'Edit permission denied');
            return;
        }
        await prisma.boardEvent.create({
            data: {
                boardId,
                pageId: pageId || null,
                type: event.type,
                payload: event
            }
        });
        const room = pageId ? `page:${pageId}` : `board:${boardId}`;
        socket.to(room).emit('canvas-event', event);
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.data.userName);
    });
});
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
export { prisma };
//# sourceMappingURL=index.js.map
import { config } from 'dotenv';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaClient } from '@repo/db';
import { Redis } from 'ioredis';
import { verifySessionToken, WebSocketSession } from './auth.js';
import {
    WebSocketMessage,
    WebSocketMessageSchema,
    ErrorResponse,
    ErrorResponseSchema,
    JoinedRoomResponse,
    JoinedRoomResponseSchema,
    NextQuestionResponse,
    NextQuestionResponseSchema,
    EndQuestionResponse,
    EndQuestionResponseSchema,
    ParticipantLeftResponse,
    ParticipantLeftResponseSchema,
    QuizFinishedResponse,
    QuizFinishedResponseSchema,
    WebSocketError
} from './types.js';

// Load environment variables
config();

// Configuration constants
const CONFIG = {
    QUESTION_TIME_LIMIT: 10000, // 10 seconds
    QUIZ_START_DELAY: 5000, // 5 seconds
    NEXT_QUESTION_DELAY: 3000, // 3 seconds
    QUESTIONS_PER_QUIZ: 10,
    REDIS_TTL: 600, // 10 minutes
    MAX_CONNECTIONS_PER_USER: 3,
    RATE_LIMIT_WINDOW: 1000, // 1 second
    RATE_LIMIT_MAX: 10 // 10 messages per second
};

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface QuizQuestion {
    id: number;
    text: string;
    options: string[];
    correctIdx: number;
}

interface WebSocketWithUser extends WebSocket {
    userId?: number;
    currentRoom?: string;
    session?: WebSocketSession;
    lastMessageTime?: number;
    messageCount?: number;
    connectionId?: string;
}

interface RoomTimer {
    timer: NodeJS.Timeout;
    questionIndex: number;
    roomId: string;
}

const roomSockets = new Map<string, Set<WebSocketWithUser>>();
const questionsCache = new Map<string, { questions: QuizQuestion[], timestamp: number }>();
const timers = new Map<string, RoomTimer>();
const userConnections = new Map<number, Set<string>>();
const connectionCleanup = new Map<string, NodeJS.Timeout>();

// Rate limiting
const rateLimitMap = new Map<number, { count: number, resetTime: number }>();

// Cleanup interval for stale data
const CLEANUP_INTERVAL = 60000; // 1 minute
setInterval(cleanupStaleData, CLEANUP_INTERVAL);

// Redis error handling
redis.on('error', (error) => {
    console.error('Redis connection error:', error);
});

redis.on('connect', () => {
    console.log('Redis connected successfully');
});

const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            connections: wss.clients.size
        }));
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const wss = new WebSocketServer({
    server,
    clientTracking: true,
    maxPayload: 16 * 1024, // 16KB max message size
    handleProtocols: (protocols: Set<string>) => {
        const firstProtocol = Array.from(protocols)[0];
        return firstProtocol || false;
    }
});

wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

function sendResponse<T>(ws: WebSocket, response: T): boolean {
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(response));
            return true;
        } catch (error) {
            console.error('Error sending WebSocket message:', error);
            return false;
        }
    }
    return false;
}

function sendError(ws: WebSocket, code: number, message: string): boolean {
    const error: ErrorResponse = {
        type: 'error',
        payload: { code, message }
    };
    return sendResponse(ws, error);
}

function generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Rate limiting function
function checkRateLimit(userId: number): boolean {
    const now = Date.now();
    const userLimit = rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
        rateLimitMap.set(userId, { count: 1, resetTime: now + CONFIG.RATE_LIMIT_WINDOW });
        return true;
    }

    if (userLimit.count >= CONFIG.RATE_LIMIT_MAX) {
        return false;
    }

    userLimit.count++;
    return true;
}

// Connection handler
wss.on('connection', async (ws: WebSocketWithUser, req) => {
    const connectionId = generateConnectionId();
    ws.connectionId = connectionId;

    console.log(`New WebSocket connection: ${connectionId}`);

    try {
        let token: string | null = null;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            token = url.searchParams.get('token');
        }

        if (!token) {
            sendError(ws, 401, 'Missing authentication token');
            ws.close(1008, 'Missing token');
            return;
        }

        const session = await verifySessionToken(token);

        if (!session) {
            sendError(ws, 401, 'Invalid or expired token');
            ws.close(1008, 'Invalid token');
            return;
        }

        const userId = parseInt(session.sub);

        // Check connection limits per user
        const userConns = userConnections.get(userId) || new Set();
        if (userConns.size >= CONFIG.MAX_CONNECTIONS_PER_USER) {
            sendError(ws, 429, 'Too many connections for this user');
            ws.close(1008, 'Connection limit exceeded');
            return;
        }

        // Attach user info to WebSocket
        ws.userId = userId;
        ws.session = session;
        ws.currentRoom = undefined;
        ws.lastMessageTime = 0;
        ws.messageCount = 0;

        // Track user connections
        userConns.add(connectionId);
        userConnections.set(userId, userConns);

        // Set up connection cleanup timeout
        const cleanupTimeout = setTimeout(() => {
            console.log(`Connection ${connectionId} cleanup timeout`);
            cleanupConnection(ws);
        }, CONFIG.REDIS_TTL * 1000);

        connectionCleanup.set(connectionId, cleanupTimeout);

        // Message handler with rate limiting
        ws.on('message', async (data) => {
            try {
                // Rate limiting check
                if (!checkRateLimit(userId)) {
                    sendError(ws, 429, 'Rate limit exceeded');
                    return;
                }

                const message = data.toString();
                if (message.length > 1024) { // Max message size
                    sendError(ws, 413, 'Message too large');
                    return;
                }

                const parsedData = JSON.parse(message);
                const validatedMessage = WebSocketMessageSchema.parse(parsedData);
                await handleMessage(ws, validatedMessage);
            } catch (error) {
                if (error instanceof WebSocketError) {
                    sendError(ws, error.code, error.message);
                } else if (error instanceof SyntaxError) {
                    sendError(ws, 400, 'Invalid JSON format');
                } else {
                    console.error('Unexpected error handling message:', error);
                    sendError(ws, 500, 'Internal server error');
                }
            }
        });

        // close handler with proper cleanup
        ws.on('close', (code, reason) => {
            console.log(`Connection ${connectionId} closed: ${code} ${reason}`);
            cleanupConnection(ws);
        });

        // Error handler
        ws.on('error', (error) => {
            console.error(`WebSocket error for connection ${connectionId}:`, error);
            cleanupConnection(ws);
        });

        // Send connection confirmation
        sendResponse(ws, {
            type: 'connected',
            payload: { connectionId, userId }
        });

    } catch (error) {
        console.error('WebSocket connection setup error:', error);
        ws.close(1011, 'Server error');
    }
});

// cleanup function
function cleanupConnection(ws: WebSocketWithUser) {
    try {
        // Clear cleanup timeout
        if (ws.connectionId) {
            const timeout = connectionCleanup.get(ws.connectionId);
            if (timeout) {
                clearTimeout(timeout);
                connectionCleanup.delete(ws.connectionId);
            }
        }

        // Leave current room
        if (ws.currentRoom) {
            handleLeaveRoom(ws).catch(console.error);
        }

        // Remove from user connections tracking
        if (ws.userId && ws.connectionId) {
            const userConns = userConnections.get(ws.userId);
            if (userConns) {
                userConns.delete(ws.connectionId);
                if (userConns.size === 0) {
                    userConnections.delete(ws.userId);
                }
            }
        }

        // Close WebSocket if still open
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    } catch (error) {
        console.error('Error during connection cleanup:', error);
    }
}

// message handler with input validation
async function handleMessage(ws: WebSocketWithUser, message: WebSocketMessage) {
    // Input validation at the start
    if (!ws.userId) {
        throw new WebSocketError(401, 'User not authenticated');
    }

    switch (message.type) {
        case 'join':
            await handleJoinRoom(ws, message.payload);
            break;
        case 'startQuiz':
            await handleStartQuiz(ws, message.payload);
            break;
        case 'submitAnswer':
            await handleSubmitAnswer(ws, message.payload);
            break;
        case 'leaveRoom':
            await handleLeaveRoom(ws, message.payload);
            break;
        default:
            throw new WebSocketError(400, 'Unknown message type');
    }
}

// join room handler with proper transaction handling
async function handleJoinRoom(ws: WebSocketWithUser, payload: { roomId: string }) {
    const { roomId } = payload;

    // Input validation
    if (!roomId || typeof roomId !== 'string' || roomId.length > 50) {
        throw new WebSocketError(400, 'Invalid room ID');
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Check if room exists and is active
            const room = await tx.room.findUnique({
                where: { id: roomId, isActive: true },
                include: { roomParticipants: true }
            });

            if (!room) {
                throw new WebSocketError(404, 'Room not found or inactive');
            }

            if (room.roomParticipants.length >= room.maxPlayers) {
                throw new WebSocketError(400, 'Room is full');
            }

            // Check if user is already in another room
            const existingParticipant = await tx.roomParticipant.findFirst({
                where: { userId: ws.userId },
                include: { room: true }
            });

            if (existingParticipant && existingParticipant.roomId !== roomId) {
                throw new WebSocketError(400, `Already in Room: ${existingParticipant.room.name} (ID: ${existingParticipant.roomId})`);
            }

            // Add to room participants
            await tx.roomParticipant.upsert({
                where: {
                    roomId_userId: {
                        roomId,
                        userId: ws.userId!
                    }
                },
                create: {
                    roomId,
                    userId: ws.userId!
                },
                update: {}
            });

            return room;
        });

        // Redis operations outside transaction
        await redis.sadd(`room:${roomId}:participants`, ws.userId!.toString());
        await redis.expire(`room:${roomId}:participants`, CONFIG.REDIS_TTL);

        // Add to room sockets
        if (!roomSockets.has(roomId)) {
            roomSockets.set(roomId, new Set());
        }
        roomSockets.get(roomId)!.add(ws);
        ws.currentRoom = roomId;

        // Get user details for broadcast
        const user = await prisma.user.findUnique({
            where: { id: ws.userId }
        });

        // Broadcast participant joined
        broadcastToRoom(roomId, {
            type: 'participantJoined',
            payload: {
                userId: ws.userId!,
                userName: user?.name || 'Anonymous'
            }
        });

        // Send confirmation
        const response: JoinedRoomResponse = {
            type: 'joinedRoom',
            payload: { roomId }
        };
        sendResponse(ws, response);

    } catch (error) {
        if (error instanceof WebSocketError) {
            throw error;
        }
        console.error('Error joining room:', error);
        throw new WebSocketError(500, 'Failed to join room');
    }
}

// start quiz handler
async function handleStartQuiz(ws: WebSocketWithUser, payload: { roomId: string }) {
    const { roomId } = payload;

    // Input validation
    if (!roomId || typeof roomId !== 'string') {
        throw new WebSocketError(400, 'Invalid room ID');
    }

    try {
        // Verify host authorization
        const room = await prisma.room.findUnique({
            where: { id: roomId }
        });

        if (!room || room.hostId !== ws.userId) {
            throw new WebSocketError(403, 'Only room host can start quiz');
        }

        // Check if quiz is already running
        const currentQuestion = await redis.get(`room:${roomId}:currentQuestion`);
        if (currentQuestion !== null) {
            throw new WebSocketError(409, 'Quiz already in progress');
        }

        // Get random questions with better distribution
        const questionCount = await prisma.question.count();
        if (questionCount < CONFIG.QUESTIONS_PER_QUIZ) {
            throw new WebSocketError(500, 'Not enough questions available');
        }

        const skip = Math.max(0, Math.floor(Math.random() * (questionCount - CONFIG.QUESTIONS_PER_QUIZ)));
        const orderDir = Math.random() < 0.5 ? 'asc' : 'desc';

        const questions = await prisma.question.findMany({
            take: CONFIG.QUESTIONS_PER_QUIZ,
            skip: skip,
            orderBy: { id: orderDir }
        });

        // Store in cache with timestamp
        questionsCache.set(roomId, {
            questions,
            timestamp: Date.now()
        });

        // Initialize Redis state
        await redis.multi()
            .set(`room:${roomId}:currentQuestion`, '-1') // -1 means quiz starting
            .expire(`room:${roomId}:currentQuestion`, CONFIG.REDIS_TTL)
            .set(`room:${roomId}:startTime`, Date.now().toString())
            .expire(`room:${roomId}:startTime`, CONFIG.REDIS_TTL)
            .exec();

        // Broadcast quiz start
        broadcastToRoom(roomId, {
            type: 'quizStarting',
            payload: {
                roomId,
                startDelay: CONFIG.QUIZ_START_DELAY,
                questionCount: CONFIG.QUESTIONS_PER_QUIZ
            }
        });

        // Schedule first question
        const startTimer = setTimeout(() => {
            handleNextQuestion(roomId, 0).catch(console.error);
        }, CONFIG.QUIZ_START_DELAY);

        // Store timer for cleanup
        timers.set(`${roomId}:start`, {
            timer: startTimer,
            questionIndex: -1,
            roomId
        });

    } catch (error) {
        if (error instanceof WebSocketError) {
            throw error;
        }
        console.error('Error starting quiz:', error);
        throw new WebSocketError(500, 'Failed to start quiz');
    }
}

// submit answer handler with server-controlled timing
async function handleSubmitAnswer(ws: WebSocketWithUser, payload: {
    roomId: string,
    questionIndex: number,
    choiceIdx: number
}) {
    const { roomId, questionIndex, choiceIdx } = payload;

    // Input validation first
    if (!roomId || typeof roomId !== 'string') {
        throw new WebSocketError(400, 'Invalid room ID');
    }
    if (typeof questionIndex !== 'number' || questionIndex < 0 || questionIndex >= CONFIG.QUESTIONS_PER_QUIZ) {
        throw new WebSocketError(400, 'Invalid question index');
    }
    if (typeof choiceIdx !== 'number' || choiceIdx < 0 || choiceIdx > 3) {
        throw new WebSocketError(400, 'Invalid choice index');
    }

    try {
        // Verify room participation
        if (ws.currentRoom !== roomId) {
            throw new WebSocketError(403, 'Not in this room');
        }

        const isParticipant = await redis.sismember(
            `room:${roomId}:participants`,
            ws.userId!.toString()
        );

        if (!isParticipant) {
            throw new WebSocketError(403, 'Not a participant in this room');
        }

        // Verify current question and check if expired
        const pipeline = redis.pipeline();
        pipeline.get(`room:${roomId}:currentQuestion`);
        pipeline.get(`room:${roomId}:q:${questionIndex}:answered:${ws.userId}`);
        pipeline.exists(`room:${roomId}:q:${questionIndex}:firstUser`);
        pipeline.exists(`room:${roomId}:q:${questionIndex}:expired`); // Check if question expired

        const results = await pipeline.exec();

        if (!results || results.some(([err]) => err)) {
            throw new WebSocketError(500, 'Failed to verify question state');
        }

        const [currentQuestion, hasAnswered, hasWinner, isExpired] = results.map(([, result]) => result);

        if (currentQuestion !== questionIndex.toString()) {
            throw new WebSocketError(409, 'Question no longer active');
        }

        if (isExpired) {
            throw new WebSocketError(410, 'Question has expired');
        }

        if (hasAnswered) {
            return; // Silently ignore duplicate submissions
        }

        // Mark as answered atomically
        const answerKey = `room:${roomId}:q:${questionIndex}:answered:${ws.userId}`;
        const setResult = await redis.set(answerKey, '1', 'EX', CONFIG.REDIS_TTL, 'NX');

        if (!setResult) {
            return; // Already answered (race condition)
        }

        // Check if answer is correct
        const questionData = questionsCache.get(roomId);
        const currentQuestionObj = questionData?.questions[questionIndex];

        if (!currentQuestionObj) {
            throw new WebSocketError(500, 'Question not found');
        }

        if (currentQuestionObj.correctIdx !== choiceIdx) {
            return; // Incorrect answer, no further action needed
        }

        // Try to claim first correct answer atomically
        const winnerKey = `room:${roomId}:q:${questionIndex}:firstUser`;
        const claimResult = await redis.set(winnerKey, ws.userId!.toString(), 'EX', CONFIG.REDIS_TTL, 'NX');

        if (!claimResult) {
            return; // Someone else already got it
        }

        // Record in database with proper transaction handling
        try {
            await prisma.$transaction(async (tx) => {
                // Create answer claim
                await tx.answerClaim.create({
                    data: {
                        roomId,
                        questionIndex,
                        userId: ws.userId!,
                        txHash: `claim_${roomId}_${questionIndex}_${ws.userId}_${Date.now()}`
                    }
                });

                // Update participant score
                await tx.roomParticipant.update({
                    where: {
                        roomId_userId: {
                            roomId,
                            userId: ws.userId!
                        }
                    },
                    data: {
                        score: { increment: 1 }
                    }
                });
            });
        } catch (dbError: any) {
            console.error('Database error recording answer:', dbError);
        }

        // Clear question timer since someone answered correctly
        const timerKey = `${roomId}:${questionIndex}`;
        const roomTimer = timers.get(timerKey);
        if (roomTimer) {
            clearTimeout(roomTimer.timer);
            timers.delete(timerKey);
        }

        // Broadcast end of question
        const message: EndQuestionResponse = {
            type: 'endQuestion',
            payload: {
                questionIndex,
                correctIdx: currentQuestionObj.correctIdx,
                winnerUserId: ws.userId!
            }
        };

        broadcastToRoom(roomId, message);

        // Schedule next question or finish quiz
        const nextTimer = setTimeout(() => {
            if (questionIndex < CONFIG.QUESTIONS_PER_QUIZ - 1) {
                handleNextQuestion(roomId, questionIndex + 1).catch(console.error);
            } else {
                handleQuizFinished(roomId).catch(console.error);
            }
        }, CONFIG.NEXT_QUESTION_DELAY);

        timers.set(`${roomId}:next-${questionIndex}`, {
            timer: nextTimer,
            questionIndex: questionIndex + 1,
            roomId
        });

    } catch (error) {
        if (error instanceof WebSocketError) {
            throw error;
        }
        console.error('Error submitting answer:', error);
        throw new WebSocketError(500, 'Failed to submit answer');
    }
}

// leave room handler
async function handleLeaveRoom(ws: WebSocketWithUser, payload?: { roomId: string }) {
    const roomId = payload?.roomId || ws.currentRoom;
    if (!roomId || !ws.userId) return;

    try {
        // Use transaction for data consistency
        await prisma.$transaction(async (tx) => {
            // Remove from room participants
            await tx.roomParticipant.deleteMany({
                where: {
                    roomId,
                    userId: ws.userId!
                }
            });
        });

        // Redis cleanup
        await redis.srem(`room:${roomId}:participants`, ws.userId.toString());

        // Remove from room sockets
        const roomWs = roomSockets.get(roomId);
        if (roomWs) {
            roomWs.delete(ws);
            if (roomWs.size === 0) {
                roomSockets.delete(roomId);
                // Clean up room data
                cleanupRoomData(roomId);
            }
        }

        ws.currentRoom = undefined;

        // Broadcast participant left
        const message: ParticipantLeftResponse = {
            type: 'participantLeft',
            payload: { userId: ws.userId }
        };
        broadcastToRoom(roomId, message);

    } catch (error) {
        console.error('Error leaving room:', error);
    }
}

// broadcast function with error handling
function broadcastToRoom(roomId: string, message: any) {
    const sockets = roomSockets.get(roomId);
    if (!sockets || sockets.size === 0) return;

    const messageStr = JSON.stringify(message);
    const deadSockets: WebSocketWithUser[] = [];

    sockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(messageStr);
            } catch (error) {
                console.error('Error broadcasting to socket:', error);
                deadSockets.push(ws);
            }
        } else {
            deadSockets.push(ws);
        }
    });

    // Clean up dead sockets
    deadSockets.forEach(ws => {
        sockets.delete(ws);
        cleanupConnection(ws);
    });
}

// question expiry handler with server-controlled timing
async function handleQuestionExpiry(roomId: string, questionIndex: number) {
    try {
        const questionData = questionsCache.get(roomId);
        if (!questionData || !questionData.questions[questionIndex]) return;

        // Check if question was already answered (prevents race conditions)
        const hasWinner = await redis.exists(`room:${roomId}:q:${questionIndex}:firstUser`);
        if (hasWinner) return; // Already handled by answer submission

        // Mark question as expired in Redis to prevent late answers
        await redis.set(
            `room:${roomId}:q:${questionIndex}:expired`,
            '1',
            'EX',
            CONFIG.REDIS_TTL
        );

        const message: EndQuestionResponse = {
            type: 'endQuestion',
            payload: {
                questionIndex,
                correctIdx: questionData.questions[questionIndex].correctIdx,
                winnerUserId: null  // No winner due to timeout
            }
        };

        broadcastToRoom(roomId, message);

        // Schedule next question or finish quiz
        const nextTimer = setTimeout(() => {
            if (questionIndex < CONFIG.QUESTIONS_PER_QUIZ - 1) {
                handleNextQuestion(roomId, questionIndex + 1).catch(console.error);
            } else {
                handleQuizFinished(roomId).catch(console.error);
            }
        }, CONFIG.NEXT_QUESTION_DELAY);

        timers.set(`${roomId}:next-${questionIndex}`, {
            timer: nextTimer,
            questionIndex: questionIndex + 1,
            roomId
        });

    } catch (error) {
        console.error('Error handling question expiry:', error);
    }
}

// next question handler with server timestamps
async function handleNextQuestion(roomId: string, questionIndex: number) {
    try {
        const questionData = questionsCache.get(roomId);
        if (!questionData || !questionData.questions[questionIndex]) {
            console.error(`Question ${questionIndex} not found for room ${roomId}`);
            return;
        }

        // Update current question in Redis
        await redis.set(`room:${roomId}:currentQuestion`, questionIndex.toString(), 'EX', CONFIG.REDIS_TTL);

        // Create server timestamps for precise timing control
        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + CONFIG.QUESTION_TIME_LIMIT);

        const message: NextQuestionResponse = {
            type: 'nextQuestion',
            payload: {
                questionIndex,
                question: questionData.questions[questionIndex],
                startedAt: startedAt.toISOString(),
                expiresAt: expiresAt.toISOString()
            }
        };

        broadcastToRoom(roomId, message);

        // Set timer for question expiry based on exact server timing
        const timer = setTimeout(() =>
            handleQuestionExpiry(roomId, questionIndex),
            CONFIG.QUESTION_TIME_LIMIT  // Use exact config duration
        );

        timers.set(`${roomId}:${questionIndex}`, {
            timer,
            questionIndex,
            roomId
        });

    } catch (error) {
        console.error('Error handling next question:', error);
    }
}

// quiz finished handler
async function handleQuizFinished(roomId: string) {
    try {
        // Get final standings with proper error handling
        const participants = await prisma.roomParticipant.findMany({
            where: { roomId },
            include: { user: true },
            orderBy: { score: 'desc' }
        });

        // Calculate new ratings with transaction
        const standings = await Promise.all(participants.map(async (p) => {
            try {
                const rating = await prisma.$transaction(async (tx) => {
                    const currentRating = await tx.playerRating.findUnique({
                        where: { userId: p.userId }
                    });

                    const newRating = (currentRating?.rating || 1200) + (p.score * 10);

                    return tx.playerRating.upsert({
                        where: { userId: p.userId },
                        create: { userId: p.userId, rating: newRating },
                        update: { rating: newRating }
                    });
                });

                return {
                    userId: p.userId,
                    userName: p.user.name || 'Anonymous',
                    score: p.score,
                    newRating: rating.rating
                };
            } catch (error) {
                console.error(`Error updating rating for user ${p.userId}:`, error);
                return {
                    userId: p.userId,
                    userName: p.user.name || 'Anonymous',
                    score: p.score,
                    newRating: 1200 + (p.score * 10) // Fallback calculation
                };
            }
        }));

        // Broadcast final standings
        const message: QuizFinishedResponse = {
            type: 'quizFinished',
            payload: { standings }
        };
        broadcastToRoom(roomId, message);

        // Cleanup room data
        cleanupRoomData(roomId);

    } catch (error) {
        console.error('Error finishing quiz:', error);
        // Still cleanup even if there was an error
        cleanupRoomData(roomId);
    }
}

// room cleanup to clear expired flags
function cleanupRoomData(roomId: string) {
    try {
        // Clear questions cache
        questionsCache.delete(roomId);
        
        // Clear all timers for this room
        const timerKeys = Array.from(timers.keys()).filter(key => key.startsWith(`${roomId}:`));
        timerKeys.forEach(key => {
            const roomTimer = timers.get(key);
            if (roomTimer) {
                clearTimeout(roomTimer.timer);
                timers.delete(key);
            }
        });

        // Clear Redis keys
        const keysToDelete = [
            `room:${roomId}:currentQuestion`,
            `room:${roomId}:participants`,
            `room:${roomId}:startTime`
        ];
        
        // Add question-specific keys including expired flags
        for (let i = 0; i < CONFIG.QUESTIONS_PER_QUIZ; i++) {
            keysToDelete.push(
                `room:${roomId}:q:${i}:firstUser`,
                `room:${roomId}:q:${i}:expired`  // NEW: Clean up expired flags
            );
        }
        
        redis.del(...keysToDelete).catch(console.error);

        console.log(`Cleaned up room data for ${roomId}`);
    } catch (error) {
        console.error(`Error cleaning up room ${roomId}:`, error);
    }
}

// Periodic cleanup function for stale data
function cleanupStaleData() {
    try {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000; // 30 minutes

        // Clean up stale questions cache
        for (const [roomId, data] of questionsCache.entries()) {
            if (now - data.timestamp > staleThreshold) {
                questionsCache.delete(roomId);
                console.log(`Cleaned up stale questions cache for room ${roomId}`);
            }
        }

        // Clean up stale rate limit entries
        for (const [userId, data] of rateLimitMap.entries()) {
            if (now > data.resetTime + 60000) { // Keep for 1 minute after reset
                rateLimitMap.delete(userId);
            }
        }

        // Clean up empty user connection sets
        for (const [userId, connections] of userConnections.entries()) {
            if (connections.size === 0) {
                userConnections.delete(userId);
            }
        }

        console.log('Periodic cleanup completed');
    } catch (error) {
        console.error('Error during periodic cleanup:', error);
    }
}

// Graceful shutdown handler
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal: string) {
    console.log(`Received ${signal}, starting graceful shutdown...`);

    try {
        // Stop accepting new connections
        wss.close(() => {
            console.log('WebSocket server closed');
        });

        // Close all existing connections
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1001, 'Server shutting down');
            }
        });

        // Clear all timers
        timers.forEach(({ timer }) => clearTimeout(timer));
        timers.clear();

        // Clear all connection cleanup timeouts
        connectionCleanup.forEach(timeout => clearTimeout(timeout));
        connectionCleanup.clear();

        // Close database connection
        await prisma.$disconnect();
        console.log('Database connection closed');

        // Close Redis connection
        redis.disconnect();
        console.log('Redis connection closed');

        // Close HTTP server
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });

        // Force exit after 10 seconds
        setTimeout(() => {
            console.log('Force shutdown after timeout');
            process.exit(1);
        }, 10000);

    } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
}

// error handling for unhandled errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`WebSocket server is running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface Participant {
  userId: number;
  userName: string;
  score: number;
}

interface RoomDetails {
  id: string;
  name: string;
  hostId: number;
  isActive: boolean;
  maxPlayers: number;
  password: string | null;
  createdAt: string;
  participants: Participant[];
}

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

interface RoomLobbyProps {
  params: Promise<{ roomId: string }> | { roomId: string };
}

export default function RoomLobby({ params }: RoomLobbyProps) {
  // Fix: Handle params properly without experimental use() API
  const [roomId, setRoomId] = useState<string>('');
  const router = useRouter();
  const { data: session } = useSession();
  const [room, setRoom] = useState<RoomDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);

  // Handle params resolution
  useEffect(() => {
    const resolveParams = async () => {
      const resolvedParams = await Promise.resolve(params);
      setRoomId(resolvedParams.roomId);
    };
    resolveParams();
  }, [params]);

  // Fetch room details
  useEffect(() => {
    if (!roomId) return;

    async function fetchRoom() {
      try {
        const response = await fetch(`/api/rooms/${roomId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch room details');
        }
        const data = await response.json();
        setRoom(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchRoom();
  }, [roomId]);

  // Enhanced WebSocket message handler with better error handling
  const handleWebSocketMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket message:', message);

        // More lenient validation - check for basic structure
        if (!message || typeof message !== 'object') {
          console.warn('Invalid message format - not an object:', message);
          return;
        }

        if (!message.type || typeof message.type !== 'string') {
          console.warn('Invalid message format - missing or invalid type:', message);
          return;
        }

        // Log the message type for debugging
        console.log('Processing message type:', message.type);

        switch (message.type) {
          case 'connected':
            console.log('WebSocket connected successfully');
            break;

          case 'joinedRoom':
            console.log('Successfully joined room:', message.payload?.roomId);
            break;

          case 'participantJoined':
            if (message.payload?.userId && message.payload?.userName) {
              setRoom((prev) =>
                prev
                  ? {
                      ...prev,
                      participants: [
                        ...prev.participants.filter(
                          (p) => p.userId !== message.payload.userId
                        ),
                        {
                          userId: message.payload.userId,
                          userName: message.payload.userName,
                          score: 0,
                        },
                      ],
                    }
                  : null
              );
            } else {
              console.warn('participantJoined missing required payload fields:', message.payload);
            }
            break;

          case 'participantLeft':
            if (message.payload?.userId) {
              setRoom((prev) =>
                prev
                  ? {
                      ...prev,
                      participants: prev.participants.filter(
                        (p) => p.userId !== message.payload.userId
                      ),
                    }
                  : null
              );
            } else {
              console.warn('participantLeft missing userId:', message.payload);
            }
            break;

          case 'quizStarting':
            console.log('Quiz starting, navigating to quiz page...');
            router.push(`/rooms/${roomId}/quiz`);
            break;

          case 'nextQuestion':
            // Handle if needed in lobby context
            console.log('Next question started (in lobby):', message.payload);
            break;

          case 'endQuestion':
            // Handle end of question - might be useful for lobby updates
            console.log('Question ended (in lobby):', message.payload);
            break;

          case 'quizFinished':
            // Handle quiz completion
            console.log('Quiz finished (in lobby):', message.payload);
            break;

          case 'error':
            console.error('WebSocket error:', message.payload?.message || 'Unknown error');
            setError(message.payload?.message || 'An error occurred');
            break;

          default:
            console.warn('Unknown message type:', message.type, 'Full message:', message);
            // Don't treat unknown messages as errors - just log them
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
        console.error('Raw message data:', event.data);
        
        // Try to show the raw data for debugging
        if (typeof event.data === 'string') {
          console.error('Raw string length:', event.data.length);
          console.error('First 200 chars:', event.data.substring(0, 200));
        }
      }
    },
    [roomId, router, setRoom, setError]
  );

  // WebSocket connection
  useEffect(() => {
    if (!session?.user || !roomId || typeof window === 'undefined') return;

    // Check if WebSocket already exists (to prevent multiple connections)
    if ((window as any).roomWebSocket) {
      console.log('WebSocket already exists, reusing connection.');
      setWs((window as any).roomWebSocket);
      return;
    }

    const connectWebSocket = async () => {
      try {
        const tokenResponse = await fetch('/api/auth/token');
        if (!tokenResponse.ok) throw new Error('Failed to get auth token');
        const { token } = await tokenResponse.json();

        const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}?token=${token}`;
        const socket = new WebSocket(wsUrl);
        (window as any).roomWebSocket = socket; // Store globally to persist across component unmounts

        socket.onopen = async () => {
          console.log('WebSocket connected');
          setWs(socket);
          setWsError(null);

          // artificial delay to give time for the setup of onmessage handler
          await new Promise((r) => setTimeout(r, 100));

          // Send join request after connection is established
          socket.send(
            JSON.stringify({
              type: 'join',
              payload: { roomId },
            })
          );
        };

        socket.onmessage = handleWebSocketMessage;

        socket.onerror = (err) => {
          console.error('WebSocket error:', err);
          setWsError('WebSocket connection error');
        };

        socket.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason);
          setWs(null);
          delete (window as any).roomWebSocket;

          // Attempt to reconnect if connection was lost unexpectedly (not manually closed) and connection limit was not exceeded
          if (event.code !== 1000 && event.code !== 1008 && session?.user) {
            setTimeout(connectWebSocket, 3000);
          }
        };
      } catch (err) {
        console.error('Failed to connect to WebSocket:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect to WebSocket');
      }
    };

    connectWebSocket();

    return () => {
      // CLEANUP on unmount or dependencies change
      if (ws) {
        ws.onmessage = null;
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, 'Component unmounted');
        }
        delete (window as any).roomWebSocket;
      }
      setWs(null);
    };
  }, [roomId, session?.user, handleWebSocketMessage]);

  const handleStartQuiz = useCallback(() => {
    const socket = (window as any).roomWebSocket as WebSocket | undefined;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('WebSocket connection not available');
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'startQuiz',
        payload: { roomId },
      })
    );
  }, [roomId]);

  const handleLeave = useCallback(() => {
    const socket = (window as any).roomWebSocket as WebSocket | undefined;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'leaveRoom',
          payload: { roomId },
        })
      );
    }

    // remove global ref immediately
    delete (window as any).roomWebSocket;
    setWs(null);

    router.push('/rooms');
    setLeft(true);
  }, [roomId, router]);

  if (left) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Leaving room...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading room...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500 text-xl">{error}</div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Room not found</div>
      </div>
    );
  }

  const user = session?.user as SessionUser | undefined;
  const isHost =
    user?.id && room.hostId && parseInt(user.id) === room.hostId;

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">{room.name}</h1>
            <button
              onClick={handleLeave}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Leave Room
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">Room Details</h2>
              <div className="space-y-2">
                <p>
                  <span className="font-medium">Host:</span> {room.hostId}
                </p>
                <p>
                  <span className="font-medium">Max Players:</span> {room.maxPlayers}
                </p>
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  {room.isActive ? 'Active' : 'Inactive'}
                </p>
                <p>
                  <span className="font-medium">Created:</span>{' '}
                  {new Date(room.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">
                Participants ({room.participants.length}/{room.maxPlayers})
              </h2>
              {room.participants.length === 0 ? (
                <p className="text-gray-500">No participants yet...</p>
              ) : (
                <ul className="space-y-2">
                  {room.participants.map((participant) => (
                    <li
                      key={participant.userId}
                      className="flex justify-between items-center"
                    >
                      <span>{participant.userName}</span>
                      <span className="text-gray-500">
                        Score: {participant.score}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {isHost && room.isActive && (
            <div className="mt-8 text-center">
              <button
                onClick={handleStartQuiz}
                disabled={!ws || ws.readyState !== WebSocket.OPEN}
                className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Quiz
              </button>
            </div>
          )}

          {!isHost && (
            <div className="mt-8 text-center text-gray-600">
              Waiting for host to start the quiz...
            </div>
          )}

          {wsError && (
            <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">{wsError}</div>
          )}

          {(!ws || ws.readyState !== WebSocket.OPEN) && (
            <div className="mt-4 p-4 bg-yellow-100 text-yellow-700 rounded">
              Connecting to real-time updates...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
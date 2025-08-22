export interface User {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface Room {
  id: string;
  name: string;
  hostId: number;
  isActive: boolean;
  maxPlayers: number;
  password: string | null;
  createdAt: string;
  currentPlayers: number; // Added to prevent race conditions
}

export interface Participant {
  userId: number;
  userName: string;
  score: number;
  isHost: boolean; // Added to easily identify host
}

export interface RoomDetails extends Room {
  participants: Participant[];
}

export interface CreateRoomRequest {
  name: string;
  maxPlayers: number;
  password?: string;
}

export interface JoinRoomRequest {
  password?: string;
}

// WebSocket message types
export interface WSMessage<T = any> {
  type: string;
  payload: T;
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface StartQuizPayload {
  roomId: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

export interface CreateRoomFormData {
  name: string;
  maxPlayers: number;
  password: string;
}

export interface ValidationErrors {
  name?: string;
  maxPlayers?: string;
  password?: string;
} 
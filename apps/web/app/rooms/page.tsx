import { Room } from '@/types';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PrismaClient } from '@repo/db';

const prisma = new PrismaClient();

interface RoomWithParticipants extends Room {
  roomParticipants: Array<{ id: string }>;
  currentPlayers: number;
}

async function getRooms(): Promise<RoomWithParticipants[]> {
  try {
    const rooms = await prisma.room.findMany({
      where: {
        isActive: true
      },
      include: {
        roomParticipants: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return rooms.map((room: any) => ({
      ...room,
      currentPlayers: room.roomParticipants.length
    }));
  } catch (error) {
    console.error('Error fetching rooms:', error);
    return [];
  }
}

export default async function RoomsPage() {
  // Check authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/signin');
  }

  const rooms = await getRooms();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Available Rooms</h1>
            <Link
              href="/rooms/create"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Create New Room
            </Link>
          </div>

          {/* Rooms List */}
          {rooms.length === 0 ? (
            <div className="text-center py-4 text-gray-500">No active rooms found</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room: RoomWithParticipants) => {
                const currentPlayers = room.currentPlayers;
                const maxPlayers = room.maxPlayers;
                const isFull = currentPlayers >= maxPlayers;

    return (
                  <div
                    key={room.id}
                    className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow"
                  >
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{room.name}</h3>
                    <div className="space-y-2 text-sm text-gray-500">
                      <p>Host: {room.hostId}</p>
                      <p>Players: {currentPlayers} / {maxPlayers}</p>
                      <p>Created: {new Date(room.createdAt).toLocaleString()}</p>
                    </div>
                    {room.isActive && !isFull ? (
                      <Link
                        href={`/rooms/${room.id}`}
                        className="mt-4 block w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Join Room
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="mt-4 block w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-400 cursor-not-allowed"
                      >
                        {!room.isActive ? 'Inactive' : 'Room Full'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
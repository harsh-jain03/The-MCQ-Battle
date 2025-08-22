import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@repo/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const prisma = new PrismaClient();

export async function GET(
    request: NextRequest,
    { params }: { params: { roomId: string } }
) {
    try {
        // Check authentication
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json(
                { error: { code: 401, message: "Unauthorized: missing or invalid token" } },
                { status: 401 }
            );
        }

        const { roomId } = await params;

        // Get room with host and participants
        const room = await prisma.room.findUnique({
            where: { id: roomId },
            include: {
                host: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                roomParticipants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        if (!room) {
            return NextResponse.json(
                { error: { code: 404, message: "Room not found" } },
                { status: 404 }
            );
        }

        // Format response according to specification
        const response = {
            id: room.id,
            hostId: room.hostId,
            hostName: room.host.name || "Anonymous",
            isActive: room.isActive,
            maxPlayers: room.maxPlayers,
            requiresPassword: !!room.password,
            participantCount: room.roomParticipants.length,
            participants: room.roomParticipants.map(participant => ({
                userId: participant.userId,
                userName: participant.user.name || "Anonymous",
                score: participant.score,
                joinedAt: participant.joinedAt.toISOString()
            })),
            createdAt: room.createdAt.toISOString()
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error("Error fetching room:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: { roomId: string } }
) {
    try {
        // Check authentication
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: { code: 401, message: "Unauthorized: missing or invalid token" } },
                { status: 401 }
            );
        }

        const { roomId } = await context.params;
        const userId = parseInt(session.user.id);

        // Get room to check ownership
        const room = await prisma.room.findUnique({
            where: { id: roomId }
        });

        if (!room) {
            return NextResponse.json(
                { error: { code: 404, message: "Room not found" } },
                { status: 404 }
            );
        }

        // Check if user is the host
        if (room.hostId !== userId) {
            return NextResponse.json(
                { error: { code: 403, message: "Only the host can delete this room" } },
                { status: 403 }
            );
        }

        // Delete the room (this will cascade delete participants due to Prisma relations)
        await prisma.room.delete({
            where: { id: roomId }
        });

        // Return 204 No Content as specified
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error("Error deleting room:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
} 
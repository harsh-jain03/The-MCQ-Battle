import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@repo/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        
        if (!session?.user) {
            console.log("No session or user found");
            return NextResponse.json(
                { error: { code: 401, message: "Unauthorized: missing or invalid token" } },
                { status: 401 }
            );
        }

        const searchParams = request.nextUrl.searchParams;
        const limit = parseInt(searchParams.get("limit") || "20");
        const offset = parseInt(searchParams.get("offset") || "0");

        if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) {
            return NextResponse.json(
                { error: { code: 400, message: "Bad Request: invalid pagination parameters" } },
                { status: 400 }
            );
        }

        const total = await prisma.room.count({
            where: { isActive: true }
        });

        const rooms = await prisma.room.findMany({
            where: { isActive: true },
            include: {
                host: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                roomParticipants: true
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset
        });

        const formattedRooms = rooms.map(room => ({
            id: room.id,
            name: room.name,
            hostId: room.hostId,
            isActive: room.isActive,
            maxPlayers: room.maxPlayers,
            currentPlayers: room.roomParticipants.length,
            password: room.password,
            createdAt: room.createdAt.toISOString()
        }));

        return NextResponse.json(formattedRooms);

    } catch (error) {
        console.error("Error fetching rooms:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const { name, maxPlayers = 4, password } = body;

        if (!name || name.trim().length === 0) {
            return NextResponse.json(
                { error: "Room name is required" },
                { status: 400 }
            );
        }

        if (maxPlayers < 2 || maxPlayers > 10) {
            return NextResponse.json(
                { error: "maxPlayers must be between 2 and 10" },
                { status: 400 }
            );
        }

        if (password && password.length < 4) {
            return NextResponse.json(
                { error: "Password must be at least 4 characters" },
                { status: 400 }
            );
        }

        const room = await prisma.room.create({
            data: {
                name: name.trim(),
                maxPlayers,
                password,
                hostId: parseInt(session.user.id),
                isActive: true,
            }
        });

        const response = {
            id: room.id,
            name: room.name,
            hostId: room.hostId,
            isActive: room.isActive,
            maxPlayers: room.maxPlayers,
            currentPlayers: 1,
            password: room.password,
            createdAt: room.createdAt.toISOString()
        };

        return NextResponse.json(response, { status: 201 });
    } catch (error) {
        console.error("Error creating room:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
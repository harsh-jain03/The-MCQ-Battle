import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { PrismaClient } from "@repo/db";

const prisma = new PrismaClient();

export async function requireAdmin() {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
        return {
            error: NextResponse.json(
                { error: { code: 401, message: "Unauthorized: missing or invalid token" } },
                { status: 401 }
            )
        };
    }

    const user = await prisma.user.findUnique({
        where: { id: parseInt(session.user.id) },
        select: { isAdmin: true }
    });

    if (!user?.isAdmin) {
        return {
            error: NextResponse.json(
                { error: { code: 403, message: "Forbidden: admin access required" } },
                { status: 403 }
            )
        };
    }

    return { error: null };
} 
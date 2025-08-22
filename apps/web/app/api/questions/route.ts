import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@repo/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const questions = await prisma.question.findMany({
            orderBy: { id: 'asc' }
        });

        return NextResponse.json({ questions });
    } catch (error) {
        console.error("Error fetching questions:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const body = await request.json();
        const { text, options, correctIdx } = body;

        if (!text || !options || !Array.isArray(options) || options.length !== 4 || 
            typeof correctIdx !== 'number' || correctIdx < 0 || correctIdx >= 4) {
            return NextResponse.json(
                { error: { code: 400, message: "Invalid question format" } },
                { status: 400 }
            );
        }

        const question = await prisma.question.create({
            data: {
                text,
                options,
                correctIdx
            }
        });

        return NextResponse.json(question, { status: 201 });
    } catch (error) {
        console.error("Error creating question:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
} 
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@repo/db";
import { hash } from "bcrypt";

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
    try {
        const { email, password, name } = await request.json();

        if (!email || !password) {
            return NextResponse.json(
                { error: { code: 400, message: "Bad Request: email and password are required" } },
                { status: 400 }
            );
        }

        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return NextResponse.json(
                { error: { code: 400, message: "Bad Request: email already exists" } },
                { status: 400 }
            );
        }

        const hashedPassword = await hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name
            }
        });

        return NextResponse.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        }, { status: 201 });

    } catch (error) {
        console.error("Error creating user:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
} 
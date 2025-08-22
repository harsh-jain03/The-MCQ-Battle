import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@repo/db";
import { requireAdmin } from "@/lib/admin";

const prisma = new PrismaClient();

export async function PUT(
    request: NextRequest,
    context: { params: { questionId: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { questionId } = await context.params;
        const questionIdNum = parseInt(questionId);

        if (isNaN(questionIdNum)) {
            return NextResponse.json(
                { error: { code: 400, message: "Invalid question ID" } },
                { status: 400 }
            );
        }

        const body = await request.json();
        const { text, options, correctIdx } = body;

        if (!text || !options || !Array.isArray(options) || options.length !== 4 || 
            typeof correctIdx !== 'number' || correctIdx < 0 || correctIdx >= 4) {
            return NextResponse.json(
                { error: { code: 400, message: "Invalid question format" } },
                { status: 400 }
            );
        }

        const existingQuestion = await prisma.question.findUnique({
            where: { id: questionIdNum }
        });

        if (!existingQuestion) {
            return NextResponse.json(
                { error: { code: 404, message: "Question not found" } },
                { status: 404 }
            );
        }

        const updatedQuestion = await prisma.question.update({
            where: { id: questionIdNum },
            data: {
                text,
                options,
                correctIdx
            }
        });

        return NextResponse.json(updatedQuestion);
    } catch (error) {
        console.error("Error updating question:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: { questionId: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { questionId } = await context.params;
        const questionIdNum = parseInt(questionId);

        if (isNaN(questionIdNum)) {
            return NextResponse.json(
                { error: { code: 400, message: "Invalid question ID" } },
                { status: 400 }
            );
        }

        const existingQuestion = await prisma.question.findUnique({
            where: { id: questionIdNum }
        });

        if (!existingQuestion) {
            return NextResponse.json(
                { error: { code: 404, message: "Question not found" } },
                { status: 404 }
            );
        }

        await prisma.question.delete({
            where: { id: questionIdNum }
        });

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error("Error deleting question:", error);
        return NextResponse.json(
            { error: { code: 500, message: "Internal Server Error: unexpected exception" } },
            { status: 500 }
        );
    }
} 
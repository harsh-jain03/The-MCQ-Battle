import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const token = await getToken({ req: request, raw: true });
    if (!token) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ token });
}
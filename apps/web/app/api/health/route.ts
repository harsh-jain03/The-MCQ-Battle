import { NextResponse } from "next/server";

export const GET = () => {
    return NextResponse.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString() 
    });
};
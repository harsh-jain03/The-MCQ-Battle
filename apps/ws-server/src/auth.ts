import { decode } from "next-auth/jwt";

export interface WebSocketSession {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
    iat: number;
    exp: number;
    jti: string;
}

export async function verifySessionToken(token: string): Promise<WebSocketSession | null> {
    try {
        const secret = process.env.NEXTAUTH_SECRET;
        if (!secret) {
            console.error('NEXTAUTH_SECRET is not set');
            return null;
        }

        const decoded = await decode({
            token,
            secret
        });

        if (!decoded) {
            return null;
        }

        return {
            sub: decoded.sub as string,
            email: decoded.email as string,
            name: decoded.name as string,
            iat: decoded.iat as number,
            exp: decoded.exp as number,
            jti: decoded.jti as string
        };
    } catch (error) {
        console.error('Token verification failed:', error);
        return null;
    }
} 
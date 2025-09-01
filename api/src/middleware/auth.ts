import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const decoded = verifyToken(token) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true }
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
}

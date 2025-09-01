import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';

const router: express.Router = express.Router();
const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    // Generate JWT token
    const token = signToken({ userId: user.id });

    return res.status(201).json({
      user,
      token
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = signToken({ userId: user.id });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

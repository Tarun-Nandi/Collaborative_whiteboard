import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';

const router: express.Router = express.Router();
const prisma = new PrismaClient();

// GET /api/boards - List user's boards
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const boards = await prisma.board.findMany({
      where: {
        memberships: {
          some: {
            userId: req.user!.id
          }
        }
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        },
        _count: {
          select: {
            events: true
          }
        }
      }
    });

    res.json(boards);
  } catch (error) {
    return next(error);
  }
});

// POST /api/boards - Create a new board
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { title } = z.object({ title: z.string().min(1) }).parse(req.body);
    
    const board = await prisma.board.create({
      data: { 
        title, 
        ownerId: req.user!.id 
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        _count: {
          select: {
            events: true
          }
        }
      }
    });

    // Create membership for the owner
    await prisma.membership.create({
      data: { 
        userId: req.user!.id, 
        boardId: board.id, 
        role: 'OWNER' 
      }
    });

    res.status(201).json(board);
  } catch (error) {
    return next(error);
  }
});

// GET /api/boards/:id - Get board by ID (with share token support)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const shareToken = req.query.t || req.headers['x-share-token'];
    
    let board;
    let canEdit = false;
    let userId: string | undefined;
    
    if (shareToken) {
      // Access via share token
      const shareLink = await prisma.shareLink.findUnique({
        where: { token: shareToken as string },
        include: { board: true }
      });
      
      if (!shareLink || shareLink.boardId !== id) {
        return res.status(404).json({ error: 'Invalid share token or board not found' });
      }
      
      board = await prisma.board.findUnique({
        where: { id },
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          memberships: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true
                }
              }
            }
          },
          events: {
            orderBy: {
              createdAt: 'asc'
            }
          },
          _count: {
            select: {
              events: true
            }
          }
        }
      });
      
      canEdit = shareLink.canEdit;
    } else {
      // Access via JWT authentication
      try {
        const authReq = req as AuthenticatedRequest;
        await authenticateToken(authReq, res, () => {});
        
        if (!authReq.user) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        
        userId = authReq.user.id;
        
        board = await prisma.board.findFirst({
          where: {
            id,
            memberships: {
              some: {
                userId: authReq.user.id
              }
            }
          },
          include: {
            owner: {
              select: {
                id: true,
                email: true,
                name: true
              }
            },
            memberships: {
              include: {
                user: {
      select: {
        id: true,
        email: true,
                    name: true
                  }
                }
              }
            },
            events: {
              orderBy: {
                createdAt: 'asc'
              }
            },
            _count: {
              select: {
              events: true
              }
            }
          }
        });
        
        if (!board) {
          return res.status(404).json({ error: 'Board not found' });
        }
        
        // Check permissions
        const isOwner = board.ownerId === userId;
        const membership = board.memberships.find((m: any) => m.userId === userId);
        const membershipRole = membership?.role;
        
        canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid authentication' });
      }
    }
    
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    
    return res.json({
      board,
      permission: { canEdit }
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/boards/:id/share - Create share link
router.post('/:id/share', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { canEdit } = z.object({ canEdit: z.boolean() }).parse(req.body);

    // Verify user has access to this board
    const membership = await prisma.membership.findFirst({
      where: {
        userId: req.user!.id,
        boardId: id
      }
    });

    if (!membership) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const shareLink = await prisma.shareLink.create({
      data: {
        boardId: id,
        canEdit,
        token: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
      }
    });

    return res.status(201).json(shareLink);
  } catch (error) {
    return next(error);
  }
});

// POST /api/boards/:id/events - Store canvas events
router.post('/:id/events', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { events } = z.object({ events: z.array(z.any()) }).parse(req.body);
    const shareToken = req.query.t || req.headers['x-share-token'];

    let canEdit = false;
    
    if (shareToken) {
      // Check share token permissions
      const shareLink = await prisma.shareLink.findUnique({
        where: { token: shareToken as string }
      });
      
      if (!shareLink || shareLink.boardId !== id) {
        return res.status(404).json({ error: 'Invalid share token or board not found' });
      }
      
      canEdit = shareLink.canEdit;
    } else {
      // Check JWT authentication and permissions
      try {
        const authReq = req as AuthenticatedRequest;
        await authenticateToken(authReq, res, () => {});
        
        if (!authReq.user) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        
        const board = await prisma.board.findUnique({
          where: { id },
          include: { memberships: true }
        });
        
        if (!board) {
          return res.status(404).json({ error: 'Board not found' });
        }
        
        const isOwner = board.ownerId === authReq.user!.id;
        const membership = board.memberships.find((m: any) => m.userId === authReq.user!.id);
        const membershipRole = membership?.role;
        
        canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid authentication' });
      }
    }
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Edit permission denied' });
    }

    // Store events
    const storedEvents = await Promise.all(
      events.map((event) =>
        prisma.boardEvent.create({
          data: {
            boardId: id,
            type: event.type,
            payload: event
          }
        })
      )
    );

    return res.status(201).json(storedEvents);
  } catch (error) {
    return next(error);
  }
});

// GET /api/boards/:id/pages - List pages; create default if none
router.get('/:id/pages', async (req, res, next) => {
  try {
    const { id } = req.params;
    const shareToken = req.query.t || req.headers['x-share-token'];
    
    let canAccess = false;
    let userId: string | undefined;

    if (shareToken) {
      const shareLink = await prisma.shareLink.findUnique({
        where: { token: shareToken as string }
      });
      if (shareLink && shareLink.boardId === id) {
        canAccess = true;
      }
    } else {
      try {
        const authReq = req as AuthenticatedRequest;
        await authenticateToken(authReq, res, () => {});
        if (authReq.user) {
          userId = authReq.user.id;
          const board = await prisma.board.findUnique({
            where: { id },
            include: { memberships: true }
          });
          if (board) {
            const isOwner = board.ownerId === userId;
            const membership = board.memberships.find((m: any) => m.userId === userId);
            canAccess = isOwner || !!membership;
          }
        }
      } catch (authError) {
        // Continue without auth
      }
    }

    if (!canAccess) {
      return res.status(404).json({ error: 'Board not found' });
    }

    let pages = await prisma.boardPage.findMany({
      where: { boardId: id },
      orderBy: { index: 'asc' },
      include: {
        asset: true,
        _count: {
          select: { events: true }
        }
      }
    });

    // If no pages exist, create a default page
    if (pages.length === 0) {
      const defaultPage = await prisma.boardPage.create({
        data: {
          boardId: id,
          title: 'Page 1',
          index: 0,
          width: 794,
          height: 1123,
          backgroundType: 'blank'
        },
        include: {
          asset: true,
          _count: {
            select: { events: true }
          }
        }
      });
      pages = [defaultPage];
    }

    return res.json(pages);
  } catch (error) {
    return next(error);
  }
});

// POST /api/boards/:id/pages - Create a new page
router.post('/:id/pages', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if user has edit access
    const board = await prisma.board.findUnique({
      where: { id },
      include: { memberships: true }
    });
    
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    
    const isOwner = board.ownerId === req.user!.id;
    const membership = board.memberships.find((m: any) => m.userId === req.user!.id);
    const membershipRole = membership?.role;
    const canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Edit permission denied' });
    }

    const schema = z.object({
      title: z.string().optional(),
      index: z.number().optional(),
      size: z.object({
        preset: z.enum(['A4_P', 'A4_L', 'Letter_P', 'Letter_L']).optional(),
        orientation: z.enum(['portrait', 'landscape']).optional(),
        widthPx: z.number().optional(),
        heightPx: z.number().optional()
      }),
      background: z.object({
        type: z.enum(['blank', 'grid', 'pdf', 'image']),
        gridType: z.enum(['square', 'dot']).optional(),
        gridSize: z.number().optional(),
        showAxes: z.boolean().optional(),
        assetId: z.string().optional(),
        pdfPage: z.number().optional()
      }).optional()
    });

    const data = schema.parse(req.body);
    
    // Determine page size
    let width = 794, height = 1123; // Default A4 portrait
    if (data.size.preset) {
      const presets = {
        A4_P: { width: 794, height: 1123 },
        A4_L: { width: 1123, height: 794 },
        Letter_P: { width: 816, height: 1056 },
        Letter_L: { width: 1056, height: 816 }
      };
      const preset = presets[data.size.preset];
      width = preset.width;
      height = preset.height;
    } else if (data.size.widthPx && data.size.heightPx) {
      width = data.size.widthPx;
      height = data.size.heightPx;
    }

    // Get next index if not specified
    let index = data.index;
    if (index === undefined) {
      const lastPage = await prisma.boardPage.findFirst({
        where: { boardId: id },
        orderBy: { index: 'desc' }
      });
      index = (lastPage?.index ?? -1) + 1;
    }

    const page = await prisma.boardPage.create({
      data: {
        boardId: id,
        title: data.title || `Page ${index + 1}`,
        index,
        width,
        height,
        backgroundType: data.background?.type || 'blank',
        gridType: data.background?.gridType || null,
        gridSize: data.background?.gridSize || null,
        showAxes: data.background?.showAxes || false,
        assetId: data.background?.assetId || null,
        pdfPage: data.background?.pdfPage || null
      },
      include: {
        asset: true,
        _count: {
          select: { events: true }
        }
      }
    });

    return res.status(201).json(page);
  } catch (error) {
    return next(error);
  }
});

// PUT /api/boards/:id/pages/:pageId - Update page
router.put('/:id/pages/:pageId', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id, pageId } = req.params;
    
    // Check permissions (same as create)
    const board = await prisma.board.findUnique({
      where: { id },
      include: { memberships: true }
    });
    
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    
    const isOwner = board.ownerId === req.user!.id;
    const membership = board.memberships.find((m: any) => m.userId === req.user!.id);
    const membershipRole = membership?.role;
    const canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Edit permission denied' });
    }

    const schema = z.object({
      title: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      backgroundType: z.enum(['blank', 'grid', 'pdf', 'image']).optional(),
      gridType: z.enum(['square', 'dot']).optional(),
      gridSize: z.number().optional(),
      showAxes: z.boolean().optional(),
      assetId: z.string().optional(),
      pdfPage: z.number().optional()
    });

    const parsedData = schema.parse(req.body);

    // Build update data object with only defined values
    const updateData: any = {};
    if (parsedData.title !== undefined) updateData.title = parsedData.title;
    if (parsedData.width !== undefined) updateData.width = parsedData.width;
    if (parsedData.height !== undefined) updateData.height = parsedData.height;
    if (parsedData.backgroundType !== undefined) updateData.backgroundType = parsedData.backgroundType;
    if (parsedData.gridType !== undefined) updateData.gridType = parsedData.gridType;
    if (parsedData.gridSize !== undefined) updateData.gridSize = parsedData.gridSize;
    if (parsedData.showAxes !== undefined) updateData.showAxes = parsedData.showAxes;
    if (parsedData.assetId !== undefined) updateData.assetId = parsedData.assetId;
    if (parsedData.pdfPage !== undefined) updateData.pdfPage = parsedData.pdfPage;

    const page = await prisma.boardPage.update({
      where: { id: pageId },
      data: updateData,
      include: {
        asset: true,
        _count: {
          select: { events: true }
        }
      }
    });

    return res.json(page);
  } catch (error) {
    return next(error);
  }
});

// POST /api/boards/:id/pages/reorder - Reorder pages
router.post('/:id/pages/reorder', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { order } = z.object({ order: z.array(z.string()) }).parse(req.body);
    
    // Check permissions
    const board = await prisma.board.findUnique({
      where: { id },
      include: { memberships: true }
    });
    
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    
    const isOwner = board.ownerId === req.user!.id;
    const membership = board.memberships.find((m: any) => m.userId === req.user!.id);
    const membershipRole = membership?.role;
    const canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Edit permission denied' });
    }

    // Update indices
    await Promise.all(
      order.map((pageId, index) =>
        prisma.boardPage.update({
          where: { id: pageId },
          data: { index }
        })
      )
    );

    const pages = await prisma.boardPage.findMany({
      where: { boardId: id },
      orderBy: { index: 'asc' },
      include: {
        asset: true,
        _count: {
          select: { events: true }
        }
      }
    });

    return res.json(pages);
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/boards/:id/pages/:pageId - Delete page
router.delete('/:id/pages/:pageId', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id, pageId } = req.params;
    
    // Check permissions
    const board = await prisma.board.findUnique({
      where: { id },
      include: { memberships: true }
    });
    
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    
    const isOwner = board.ownerId === req.user!.id;
    const membership = board.memberships.find((m: any) => m.userId === req.user!.id);
    const membershipRole = membership?.role;
    const canEdit = isOwner || membershipRole === 'OWNER' || membershipRole === 'EDITOR';
    
    if (!canEdit) {
      return res.status(403).json({ error: 'Edit permission denied' });
    }

    // Check if this is the last page (prevent deletion)
    const pageCount = await prisma.boardPage.count({
      where: { boardId: id }
    });
    
    if (pageCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last page' });
    }

    await prisma.boardPage.delete({
      where: { id: pageId }
    });

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});



export default router;

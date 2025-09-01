'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import { socketManager } from '@/lib/socket';
import { createLaTeXInput, renderLaTeXToSVG } from '@/lib/latex';

// Tool types - simplified set
type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'latex';

// Extend Fabric's toObject to include custom fields
if (typeof window !== 'undefined' && !((fabric.Object.prototype as any).__extended)) {
  const oldToObject = fabric.Object.prototype.toObject;
  fabric.Object.prototype.toObject = function (props = []) {
    return oldToObject.call(this, [
      'id','name','fill','stroke','strokeWidth','rx','ry',
      'selectable','evented','strokeUniform','originX','originY',
      'path','points','fontSize','fontWeight','fontFamily','text','editable',
      ...props,
    ]);
  };
  (fabric.Object.prototype as any).__extended = true;
}

interface CanvasProps {
  boardId: string;
  pageId: string;
  canEdit: boolean;
  initialEvents?: any[];
  shareToken?: string | null;
  pageWidth: number;
  pageHeight: number;
  backgroundType?: string;
  gridType?: string;
  gridSize?: number;
}

interface RemoteCursor {
  dot: fabric.Circle;
  label?: fabric.Text;
  lastSeen: number;
}

const Canvas: React.FC<CanvasProps> = ({
  boardId,
  pageId,
  canEdit,
  shareToken,
  pageWidth,
  pageHeight,
  backgroundType = 'blank',
  gridType,
  gridSize = 20
}) => {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tool state
  const [tool, setTool] = useState<Tool>('select');
  const [fill, setFill] = useState('#ffffff');
  const [stroke, setStroke] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);

  // Grid state
  const [gridEnabled, setGridEnabled] = useState(backgroundType === 'grid');
  const [axesEnabled, setAxesEnabled] = useState(false);

  // Drawing state
  const drawingObjRef = useRef<fabric.Object | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  // Live cursors
  const remoteCursorsRef = useRef<Map<string, RemoteCursor>>(new Map());
  const cursorThrottleRef = useRef<NodeJS.Timeout | null>(null);

  // Object tracking
  const objectsByIdRef = useRef<Map<string, fabric.Object>>(new Map());

  // Socket state
  const socketRef = useRef<any>(null);

  // Safe canvas render function
  const safeRender = useCallback((canvas: fabric.Canvas) => {
    if (!canvas) return;
    
    try {
      const ctx = canvas.getContext();
      if (!ctx) {
        console.warn('Canvas context is null, skipping render');
        return;
      }
      
      // Verify context methods exist
      if (typeof ctx.save !== 'function' || typeof ctx.restore !== 'function') {
        console.warn('Canvas context is invalid, skipping render');
        return;
      }
      
      canvas.requestRenderAll();
    } catch (error) {
      console.warn('Canvas render error:', error);
    }
  }, []);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current || fabRef.current) return;

    try {
      const canvas = new fabric.Canvas(canvasRef.current, {
        selection: true,
        preserveObjectStacking: true,
        fireRightClick: false,
        stopContextMenu: true,
        width: pageWidth,
        height: pageHeight,
        renderOnAddRemove: false, // Prevent automatic renders during batch operations
      });

      // Verify canvas context is available and valid
      const ctx = canvas.getContext();
      if (!ctx) {
        console.error('Canvas context is null - cannot initialize');
        return;
      }

      // Additional context validation
      if (typeof ctx.save !== 'function' || typeof ctx.restore !== 'function') {
        console.error('Canvas context is invalid - missing save/restore methods');
        return;
      }

      fabRef.current = canvas;

      // Setup initial background
      updateBackground();

      return () => {
        if (canvas) {
          try {
            canvas.dispose();
          } catch (e) {
            console.warn('Error disposing canvas:', e);
          }
        }
        fabRef.current = null;
      };
    } catch (error) {
      console.error('Failed to initialize canvas:', error);
    }
  }, [pageWidth, pageHeight]);

  // Update canvas size when page dimensions change
  useEffect(() => {
    const canvas = fabRef.current;
    if (canvas && canvas.getContext()) {
      canvas.setDimensions({ width: pageWidth, height: pageHeight });
      updateBackground();
    }
  }, [pageWidth, pageHeight]);

  // Central tool applier - prevents selection while drawing
  const applyTool = useCallback((currentTool: Tool, editMode: boolean) => {
    const c = fabRef.current;
    if (!c || !c.getContext()) return;

    // Remove prior listeners to avoid stacking
    c.off('mouse:down');
    c.off('mouse:move');
    c.off('mouse:up');
    c.off('path:created');

    // Baseline
    c.isDrawingMode = false;
    c.defaultCursor = 'default';

    if (currentTool === 'select' || !editMode) {
      c.selection = true;
      c.skipTargetFind = false;
      return;
    }

    // Drawing tools: do not select/drag existing objects
    c.selection = false;
    c.skipTargetFind = true;
    c.discardActiveObject();
    safeRender(c);
    c.defaultCursor = 'crosshair';

    if (currentTool === 'pen') {
      c.isDrawingMode = true;
      const brush = c.freeDrawingBrush as fabric.PencilBrush;
      brush.color = stroke;
      brush.width = strokeWidth;
      
      c.on('path:created', (e: any) => {
        const path: fabric.Path = e.path;
        if (!path) return;
        
        const id = crypto.randomUUID();
        path.set({ 
          selectable: true, 
          evented: true,
          strokeUniform: true
        });
        (path as any).id = id;
        
        c.add(path);
        safeRender(c);
        objectsByIdRef.current.set(id, path);
        emitShapeAdd(path);
      });
      return;
    }

    // Shape tools
    const startDraw = (e: fabric.IEvent<MouseEvent>) => {
      const p = c.getPointer(e.e);
      startPointRef.current = { x: p.x, y: p.y };
      
      let obj: fabric.Object | null = null;
      
      if (currentTool === 'rect') {
        obj = new fabric.Rect({ 
          left: p.x, 
          top: p.y, 
          width: 1, 
          height: 1, 
          fill, 
          stroke, 
          strokeWidth,
          strokeUniform: true,
          selectable: false, 
          evented: false 
        });
      } else if (currentTool === 'ellipse') {
        obj = new fabric.Ellipse({ 
          left: p.x, 
          top: p.y, 
          rx: 1, 
          ry: 1, 
          fill, 
          stroke, 
          strokeWidth,
          strokeUniform: true,
          selectable: false, 
          evented: false 
        });
      } else if (currentTool === 'line') {
        obj = new fabric.Line([p.x, p.y, p.x, p.y], { 
          stroke, 
          strokeWidth,
          strokeUniform: true,
          selectable: false, 
          evented: false 
        });
      }
      
      if (obj) {
        drawingObjRef.current = obj;
        c.add(obj);
      }
    };

    const moveDraw = (e: fabric.IEvent<MouseEvent>) => {
      const obj = drawingObjRef.current;
      const start = startPointRef.current;
      if (!obj || !start) return;
      
      const p = c.getPointer(e.e);
      
      if (obj instanceof fabric.Rect) {
        obj.set({ 
          left: Math.min(p.x, start.x), 
          top: Math.min(p.y, start.y), 
          width: Math.abs(p.x - start.x), 
          height: Math.abs(p.y - start.y) 
        });
      } else if (obj instanceof fabric.Ellipse) {
        obj.set({ 
          left: Math.min(p.x, start.x), 
          top: Math.min(p.y, start.y), 
          rx: Math.abs(p.x - start.x) / 2, 
          ry: Math.abs(p.y - start.y) / 2 
        });
      } else if (obj instanceof fabric.Line) {
        obj.set({ x2: p.x, y2: p.y });
      }
      
      safeRender(c);
    };

    const endDraw = () => {
      const obj = drawingObjRef.current;
      if (!obj) return;
      
      const id = crypto.randomUUID();
      obj.set({ 
        selectable: true, 
        evented: true
      });
      (obj as any).id = id;
      obj.setCoords();
      safeRender(c);
      
      objectsByIdRef.current.set(id, obj);
      emitShapeAdd(obj);
      
      drawingObjRef.current = null;
      startPointRef.current = null;
    };

    c.on('mouse:down', startDraw);
    c.on('mouse:move', moveDraw);
    c.on('mouse:up', endDraw);

    // Text/LaTeX tools
    if (currentTool === 'text' || currentTool === 'latex') {
      c.on('mouse:up', async (e: fabric.IEvent<MouseEvent>) => {
        const p = c.getPointer(e.e);
        
        if (currentTool === 'text') {
          const text = new fabric.IText('Click to edit', {
            left: p.x,
            top: p.y,
            fontSize: 16,
            fontFamily: 'Arial',
            fill: stroke,
            editable: true
          });
          
          const id = crypto.randomUUID();
          (text as any).id = id;
          c.add(text);
          c.setActiveObject(text);
          text.enterEditing();
          objectsByIdRef.current.set(id, text);
          emitShapeAdd(text);
        } else if (currentTool === 'latex') {
          const modal = createLaTeXInput(
            async (latex: string) => {
              const svgString = await renderLaTeXToSVG(latex);
              if (svgString) {
                fabric.loadSVGFromString(svgString, (objects: fabric.Object[], options?: any) => {
                  const group = fabric.util.groupSVGElements(objects, options);
                  if (group) {
                    group.set({
                      left: p.x,
                      top: p.y,
                      selectable: true,
                      evented: true
                    });
                    
                    const id = crypto.randomUUID();
                    (group as any).id = id;
                    (group as any).latexSource = latex;
                    
                    c.add(group);
                    objectsByIdRef.current.set(id, group);
                    emitShapeAdd(group);
                  }
                });
              }
              document.body.removeChild(modal);
            },
            () => {
              document.body.removeChild(modal);
            }
          );
          document.body.appendChild(modal);
        }
      });
    }
  }, [fill, stroke, strokeWidth]);

  // Apply tool whenever tool or canEdit changes
  useEffect(() => {
    applyTool(tool, canEdit);
  }, [tool, canEdit, applyTool]);

  // Background update
  const updateBackground = useCallback(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    if (gridEnabled && backgroundType === 'grid') {
      createGridBackground();
    } else {
      canvas.setBackgroundColor('#ffffff', () => safeRender(canvas));
    }

    if (axesEnabled) {
      // Add axes overlay (simplified)
      // Implementation would go here
    }
  }, [gridEnabled, backgroundType, gridSize, axesEnabled]);

  const createGridBackground = useCallback(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = pageWidth;
    offscreenCanvas.height = pageHeight;
    const ctx = offscreenCanvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    // Draw grid
    for (let x = 0; x <= pageWidth; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, pageHeight);
      ctx.stroke();
    }

    for (let y = 0; y <= pageHeight; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(pageWidth, y);
      ctx.stroke();
    }

    const dataURL = offscreenCanvas.toDataURL();
    fabric.Image.fromURL(dataURL, (img) => {
      if (canvas) {
        canvas.setBackgroundImage(img, () => safeRender(canvas), {
          scaleX: 1,
          scaleY: 1
        });
      }
    });
  }, [pageWidth, pageHeight, gridSize]);

  // Socket events
  const emitShapeAdd = useCallback((shape: fabric.Object) => {
    if (!socketRef.current || !canEdit) return;
    
    socketRef.current.emit('shape:add', {
      boardId,
      pageId,
      shape: shape.toObject(),
      source: 'canvas'
    });
  }, [boardId, pageId, canEdit]);

  const emitShapeUpdate = useCallback((shape: fabric.Object) => {
    if (!socketRef.current || !canEdit) return;
    
    socketRef.current.emit('shape:update', {
      boardId,
      pageId,
      shape: shape.toObject(),
      source: 'canvas'
    });
  }, [boardId, pageId, canEdit]);

  const emitShapeDelete = useCallback((shape: fabric.Object) => {
    if (!socketRef.current || !canEdit) return;
    
    socketRef.current.emit('shape:delete', {
      boardId,
      pageId,
      shapeId: (shape as any).id,
      source: 'canvas'
    });
  }, [boardId, pageId, canEdit]);

  // Live cursor handling
  const emitCursor = useCallback((x: number, y: number) => {
    if (!socketRef.current) return;
    
    if (cursorThrottleRef.current) {
      clearTimeout(cursorThrottleRef.current);
    }
    
    cursorThrottleRef.current = setTimeout(() => {
      socketRef.current.emit('presence:cursor', {
        boardId,
        pageId,
        x,
        y,
        color: stroke
      });
    }, 33); // ~30fps
  }, [boardId, pageId, stroke]);

  // Socket setup
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    
    const socket = socketManager.connect(token || undefined, shareToken || undefined, boardId, pageId);
    socketRef.current = socket;

    // Handle incoming events
    socket.on('shape:add', (data) => {
      const canvas = fabRef.current;
      if (!canvas || !data.shape) return;
      
      // Mark as remote to avoid feedback loop
      data.shape.__remote = true;
      
      fabric.util.enlivenObjects([data.shape], (objects) => {
        const obj = objects[0];
        if (obj && (obj as any).id) {
          canvas.add(obj);
          objectsByIdRef.current.set((obj as any).id, obj);
          safeRender(canvas);
        }
      }, 'fabric');
    });

    socket.on('shape:update', (data) => {
      const canvas = fabRef.current;
      if (!canvas || !data.shape) return;
      
      const obj = objectsByIdRef.current.get(data.shape.id);
      if (obj) {
        obj.set(data.shape);
        obj.setCoords();
        safeRender(canvas);
      }
    });

    socket.on('shape:delete', (data) => {
      const canvas = fabRef.current;
      if (!canvas || !data.shapeId) return;
      
      const obj = objectsByIdRef.current.get(data.shapeId);
      if (obj) {
        canvas.remove(obj);
        objectsByIdRef.current.delete(data.shapeId);
        safeRender(canvas);
      }
    });

    socket.on('presence:cursor', (data) => {
      const canvas = fabRef.current;
      if (!canvas || !data.socketId) return;
      
      updateRemoteCursor(data.socketId, data.x, data.y, data.userName || 'User', data.color || '#ff0000');
    });

    return () => {
      socket.off('shape:add');
      socket.off('shape:update');
      socket.off('shape:delete');
      socket.off('presence:cursor');
    };
  }, [boardId, pageId, shareToken]);

  // Mouse tracking for cursors
  useEffect(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const handleMouseMove = (e: fabric.IEvent<MouseEvent>) => {
      const pointer = canvas.getPointer(e.e);
      emitCursor(pointer.x, pointer.y);
    };

    canvas.on('mouse:move', handleMouseMove);
    return () => {
      if (canvas) {
        canvas.off('mouse:move', handleMouseMove);
      }
    };
  }, [emitCursor]);

  // Update remote cursor
  const updateRemoteCursor = useCallback((socketId: string, x: number, y: number, userName: string, color: string) => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const cursors = remoteCursorsRef.current;
    let cursor = cursors.get(socketId);

    if (!cursor) {
      const dot = new fabric.Circle({
        radius: 4,
        fill: color,
        left: x - 4,
        top: y - 4,
        selectable: false,
        evented: false,
        excludeFromExport: true
      });

      const label = new fabric.Text(userName, {
        left: x + 8,
        top: y - 10,
        fontSize: 12,
        fill: color,
        selectable: false,
        evented: false,
        excludeFromExport: true
      });

      cursor = { dot, label, lastSeen: Date.now() };
      cursors.set(socketId, cursor);
      canvas.add(dot);
      canvas.add(label);
    } else {
      cursor.dot.set({ left: x - 4, top: y - 4 });
      cursor.label?.set({ left: x + 8, top: y - 10 });
      cursor.lastSeen = Date.now();
    }

    safeRender(canvas);
  }, []);

  // Cursor cleanup
  useEffect(() => {
    const interval = setInterval(() => {
      const canvas = fabRef.current;
      if (!canvas) return;

      const cursors = remoteCursorsRef.current;
      const now = Date.now();
      const staleThreshold = 3000; // 3 seconds

      cursors.forEach((cursor, socketId) => {
        if (now - cursor.lastSeen > staleThreshold) {
          canvas.remove(cursor.dot);
          if (cursor.label) canvas.remove(cursor.label);
          cursors.delete(socketId);
        }
      });

      safeRender(canvas);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Delete key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canEdit || !fabRef.current) return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObj = fabRef.current.getActiveObject();
        if (activeObj && (activeObj as any).id) {
          emitShapeDelete(activeObj);
          fabRef.current.remove(activeObj);
          objectsByIdRef.current.delete((activeObj as any).id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, emitShapeDelete]);

  // Object modification tracking
  useEffect(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const handleModified = (e: fabric.IEvent) => {
      const obj = e.target;
      if (obj && (obj as any).id && !(obj as any).__remote) {
        emitShapeUpdate(obj);
      }
      // Clear remote flag after handling
      if ((obj as any).__remote) {
        delete (obj as any).__remote;
      }
    };

    canvas.on('object:modified', handleModified);
    return () => {
      if (canvas) {
        canvas.off('object:modified', handleModified);
      }
    };
  }, [emitShapeUpdate]);

  if (!canEdit) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-white border-b border-gray-200 p-4 flex items-center">
          <span className="text-sm text-gray-600 font-medium px-3 py-1 bg-gray-100 rounded-full">
            View Only
          </span>
        </div>
        <div ref={containerRef} className="flex-1 overflow-hidden bg-gray-100">
          <canvas ref={canvasRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Simplified Toolbar */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between flex-wrap gap-4">
        {/* Draw Tools */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Draw:</label>
          <select 
            value={tool} 
            onChange={(e) => setTool(e.target.value as Tool)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="select">Select</option>
            <option value="pen">Pen</option>
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
          </select>
        </div>

        {/* Text Tools */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Text:</label>
          <button 
            onClick={() => setTool('text')}
            className={`btn text-sm ${tool === 'text' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Text
          </button>
          <button 
            onClick={() => setTool('latex')}
            className={`btn text-sm ${tool === 'latex' ? 'btn-primary' : 'btn-secondary'}`}
          >
            LaTeX
          </button>
        </div>

        {/* View Controls */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">View:</label>
          <button
            onClick={() => {
              setGridEnabled(!gridEnabled);
              updateBackground();
            }}
            className={`btn text-sm ${gridEnabled ? 'btn-primary' : 'btn-secondary'}`}
          >
            Grid
          </button>
          <button
            onClick={() => setAxesEnabled(!axesEnabled)}
            className={`btn text-sm ${axesEnabled ? 'btn-primary' : 'btn-secondary'}`}
          >
            Axes
          </button>
        </div>

        {/* Style Controls */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-700">Fill:</label>
            <input 
              type="color" 
              value={fill} 
              onChange={(e) => setFill(e.target.value)}
              className="w-8 h-8 p-0 border border-gray-300 rounded"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-700">Stroke:</label>
            <input 
              type="color" 
              value={stroke} 
              onChange={(e) => setStroke(e.target.value)}
              className="w-8 h-8 p-0 border border-gray-300 rounded"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-700">Width:</label>
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
              className="w-16"
            />
            <span className="text-sm text-gray-600 w-6">{strokeWidth}</span>
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 p-4">
        <div className="inline-block shadow-lg">
          <canvas ref={canvasRef} className="border border-gray-300" />
        </div>
      </div>
    </div>
  );
};

export default Canvas;

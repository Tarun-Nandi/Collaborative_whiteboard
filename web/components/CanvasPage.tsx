'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';

// Tool types - includes eraser
type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'latex' | 'eraser';

// Extend Fabric's toObject to include custom fields
if (typeof window !== 'undefined' && !((fabric.Object.prototype as any).__extended)) {
  const oldToObject = fabric.Object.prototype.toObject;
  fabric.Object.prototype.toObject = function (props = []) {
    return oldToObject.call(this, [
      'id','name','fill','stroke','strokeWidth','rx','ry',
      'selectable','evented','strokeUniform','originX','originY',
      'path','points','fontSize','fontWeight','fontFamily','text','editable',
      'kind', // For LaTeX identification
      ...props,
    ]);
  };
  (fabric.Object.prototype as any).__extended = true;
}

interface CanvasPageProps {
  pageId: string;
  boardId: string;
  canEdit: boolean;
  width: number;
  height: number;
  title: string;
  backgroundType?: string;
  gridType?: string;
  gridSize?: number;
  showAxes?: boolean;
  tool: Tool;
  fill: string;
  stroke: string;
  strokeWidth: number;
  onShapeAdd: (shape: fabric.Object) => void;
  onShapeUpdate: (shape: fabric.Object) => void;
  onShapeDelete: (shape: fabric.Object) => void;
  onCursorMove: (x: number, y: number) => void;
  onPageSettingsUpdate: (settings: any) => void;
  onDeletePage: () => void;
  isActive: boolean; // Whether this page is currently active for socket events
  isOnlyPage: boolean; // Whether this is the only page (can't delete)
}

interface RemoteCursor {
  dot: fabric.Circle;
  label?: fabric.Text;
  lastSeen: number;
}

const CanvasPage: React.FC<CanvasPageProps> = ({
  pageId,
  boardId,
  canEdit,
  width,
  height,
  title,
  backgroundType = 'blank',
  gridType,
  gridSize = 20,
  showAxes = false,
  tool,
  fill,
  stroke,
  strokeWidth,
  onShapeAdd,
  onShapeUpdate,
  onShapeDelete,
  onCursorMove,
  onPageSettingsUpdate,
  onDeletePage,
  isActive,
  isOnlyPage
}) => {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state
  const drawingObjRef = useRef<fabric.Object | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const erasingRef = useRef<boolean>(false);

  // Live cursors
  const remoteCursorsRef = useRef<Map<string, RemoteCursor>>(new Map());
  const cursorThrottleRef = useRef<NodeJS.Timeout | null>(null);

  // Object tracking
  const objectsByIdRef = useRef<Map<string, fabric.Object>>(new Map());

  // Axes objects
  const axesGroupRef = useRef<fabric.Group | null>(null);

  // Safe canvas render function
  const safeRender = useCallback((canvas: fabric.Canvas) => {
    if (!canvas) return;
    
    try {
      const ctx = canvas.getContext();
      if (!ctx || typeof ctx.save !== 'function') {
        console.warn('Canvas context invalid, skipping render');
        return;
      }
      
      canvas.requestRenderAll();
    } catch (error) {
      console.warn('Canvas render error:', error);
    }
  }, []);

  // Initialize canvas - only once per page
  useEffect(() => {
    if (!canvasRef.current || fabRef.current) return;

    try {
      const canvas = new fabric.Canvas(canvasRef.current, {
        selection: true,
        preserveObjectStacking: true,
        fireRightClick: false,
        stopContextMenu: true,
        width,
        height,
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

      // Setup initial background and axes
      updateBackground();
      updateAxes();

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
  }, []); // Empty deps - only run once

  // Update canvas size when page dimensions change
  useEffect(() => {
    const canvas = fabRef.current;
    if (canvas && canvas.getContext()) {
      canvas.setDimensions({ width, height });
      updateBackground();
      updateAxes();
    }
  }, [width, height]);

  // Update background when settings change
  useEffect(() => {
    updateBackground();
  }, [backgroundType, gridType, gridSize]);

  // Update axes when setting changes
  useEffect(() => {
    updateAxes();
  }, [showAxes]);

  // Central tool applier - prevents selection while drawing
  const applyTool = useCallback((currentTool: Tool, editMode: boolean) => {
    const c = fabRef.current;
    if (!c || !c.getContext()) return;

    // Clear all event listeners to avoid stacking
    c.off('mouse:down');
    c.off('mouse:move'); 
    c.off('mouse:up');
    c.off('path:created');

    // Reset baseline state
    c.isDrawingMode = false;
    c.defaultCursor = 'default';
    erasingRef.current = false;

    if (currentTool === 'select' || !editMode) {
      c.selection = true;
      c.skipTargetFind = false;
      return;
    }

    // Drawing tools: prevent selection of existing objects
    c.selection = false;
    c.skipTargetFind = true;
    c.discardActiveObject();
    safeRender(c);

    if (currentTool === 'pen') {
      c.isDrawingMode = true;
      c.defaultCursor = 'crosshair';
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
        
        // Ensure path stays on canvas
        c.add(path);
        safeRender(c);
        objectsByIdRef.current.set(id, path);
        onShapeAdd(path);
      });
      return;
    }

    if (currentTool === 'eraser') {
      c.defaultCursor = 'not-allowed';
      
      const startErasing = (e: fabric.IEvent<MouseEvent>) => {
        erasingRef.current = true;
        eraseAtPoint(e);
      };

      const continueErasing = (e: fabric.IEvent<MouseEvent>) => {
        if (erasingRef.current) {
          eraseAtPoint(e);
        }
      };

      const stopErasing = () => {
        erasingRef.current = false;
      };

      c.on('mouse:down', startErasing);
      c.on('mouse:move', continueErasing);
      c.on('mouse:up', stopErasing);
      return;
    }

    // Shape tools (rect, ellipse, line)
    c.defaultCursor = 'crosshair';

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
      onShapeAdd(obj);
      
      drawingObjRef.current = null;
      startPointRef.current = null;
    };

    c.on('mouse:down', startDraw);
    c.on('mouse:move', moveDraw);
    c.on('mouse:up', endDraw);

    // Text tools
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
          onShapeAdd(text);
        } else if (currentTool === 'latex') {
          // LaTeX input implementation will be handled by parent component
          // This is just a placeholder for the click position
        }
      });
    }
  }, [fill, stroke, strokeWidth, onShapeAdd]);

  // Eraser functionality
  const eraseAtPoint = useCallback((e: fabric.IEvent<MouseEvent>) => {
    const c = fabRef.current;
    if (!c || !canEdit) return;

    const p = c.getPointer(e.e);
    const objectsToRemove: fabric.Object[] = [];

    // Check each object for intersection with eraser point
    c.getObjects().forEach((obj) => {
      // Skip non-erasable objects
      if (!isErasable(obj)) return;

      // Simple hit test - check if point is within object bounds
      if (obj.containsPoint(p as fabric.Point)) {
        objectsToRemove.push(obj);
      }
    });

    // Remove objects and emit events
    objectsToRemove.forEach((obj) => {
      const id = (obj as any).id;
      if (id) {
        c.remove(obj);
        objectsByIdRef.current.delete(id);
        onShapeDelete(obj);
      }
    });

    if (objectsToRemove.length > 0) {
      safeRender(c);
    }
  }, [canEdit, onShapeDelete]);

  // Check if object is erasable
  const isErasable = useCallback((obj: fabric.Object): boolean => {
    // Don't erase text, LaTeX, grid, axes, or background
    if (obj.type === 'i-text' || obj.type === 'text') return false;
    if ((obj as any).kind === 'latex') return false;
    if ((obj as any).excludeFromExport) return false; // cursors, axes
    if (!obj.selectable || !obj.evented) return false; // background elements

    // Erase drawable objects
    return ['path', 'rect', 'ellipse', 'line', 'circle'].includes(obj.type || '');
  }, []);

  // Apply tool whenever tool or canEdit changes
  useEffect(() => {
    applyTool(tool, canEdit);
  }, [tool, canEdit, applyTool]);

  // Background update
  const updateBackground = useCallback(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    if (backgroundType === 'grid' && gridType) {
      createGridBackground();
    } else {
      canvas.setBackgroundColor('#ffffff', () => safeRender(canvas));
    }
  }, [backgroundType, gridType, gridSize]);

  const createGridBackground = useCallback(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    if (gridType === 'square') {
      // Draw grid lines
      for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (gridType === 'dot') {
      // Draw dot grid
      ctx.fillStyle = '#d0d0d0';
      for (let x = 0; x <= width; x += gridSize) {
        for (let y = 0; y <= height; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
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
  }, [width, height, gridSize, gridType]);

  // Axes update
  const updateAxes = useCallback(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    // Remove existing axes
    if (axesGroupRef.current) {
      canvas.remove(axesGroupRef.current);
      axesGroupRef.current = null;
    }

    if (!showAxes) return;

    const axesObjects: fabric.Object[] = [];
    const centerX = width / 2;
    const centerY = height / 2;

    // X-axis
    const xAxis = new fabric.Line([0, centerY, width, centerY], {
      stroke: '#666666',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    axesObjects.push(xAxis);

    // Y-axis
    const yAxis = new fabric.Line([centerX, 0, centerX, height], {
      stroke: '#666666',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    axesObjects.push(yAxis);

    // Add tick marks
    const tickSize = 5;
    const tickSpacing = gridSize || 20;

    // X-axis ticks
    for (let x = tickSpacing; x <= width; x += tickSpacing) {
      if (Math.abs(x - centerX) > tickSpacing / 2) { // Skip center
        const tick = new fabric.Line([x, centerY - tickSize, x, centerY + tickSize], {
          stroke: '#666666',
          strokeWidth: 1,
          selectable: false,
          evented: false,
          excludeFromExport: true
        });
        axesObjects.push(tick);
      }
    }

    // Y-axis ticks
    for (let y = tickSpacing; y <= height; y += tickSpacing) {
      if (Math.abs(y - centerY) > tickSpacing / 2) { // Skip center
        const tick = new fabric.Line([centerX - tickSize, y, centerX + tickSize, y], {
          stroke: '#666666',
          strokeWidth: 1,
          selectable: false,
          evented: false,
          excludeFromExport: true
        });
        axesObjects.push(tick);
      }
    }

    // Origin label
    const origin = new fabric.Text('0', {
      left: centerX + 5,
      top: centerY + 5,
      fontSize: 12,
      fill: '#666666',
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    axesObjects.push(origin);

    // Group all axes objects
    const axesGroup = new fabric.Group(axesObjects, {
      selectable: false,
      evented: false,
      excludeFromExport: true
    });

    axesGroupRef.current = axesGroup;
    canvas.add(axesGroup);
    safeRender(canvas);
  }, [showAxes, width, height, gridSize]);

  // Mouse tracking for cursors (only when active)
  useEffect(() => {
    const canvas = fabRef.current;
    if (!canvas || !isActive) return;

    const handleMouseMove = (e: fabric.IEvent<MouseEvent>) => {
      const pointer = canvas.getPointer(e.e);
      
      // Throttle cursor emissions
      if (cursorThrottleRef.current) {
        clearTimeout(cursorThrottleRef.current);
      }
      
      cursorThrottleRef.current = setTimeout(() => {
        onCursorMove(pointer.x, pointer.y);
      }, 33); // ~30fps
    };

    canvas.on('mouse:move', handleMouseMove);
    return () => {
      if (canvas) {
        canvas.off('mouse:move', handleMouseMove);
      }
    };
  }, [isActive, onCursorMove]);

  // Object modification tracking
  useEffect(() => {
    const canvas = fabRef.current;
    if (!canvas) return;

    const handleModified = (e: fabric.IEvent) => {
      const obj = e.target;
      if (obj && (obj as any).id && !(obj as any).__remote) {
        onShapeUpdate(obj);
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
  }, [onShapeUpdate]);

  // Delete key handling
  useEffect(() => {
    if (!isActive) return; // Only handle for active page

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canEdit || !fabRef.current) return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObj = fabRef.current.getActiveObject();
        if (activeObj && (activeObj as any).id) {
          onShapeDelete(activeObj);
          fabRef.current.remove(activeObj);
          objectsByIdRef.current.delete((activeObj as any).id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, isActive, onShapeDelete]);

  // Remote cursor methods
  const updateRemoteCursor = useCallback((socketId: string, x: number, y: number, userName: string, color: string) => {
    if (!isActive) return; // Only show cursors on active page

    const canvas = fabRef.current;
    if (!canvas) return;

    const cursors = remoteCursorsRef.current;
    let cursor = cursors.get(socketId);

    if (!cursor) {
      // Create cursor dot
      const dot = new fabric.Circle({
        radius: 6,
        fill: color,
        left: x - 6,
        top: y - 6,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        shadow: new fabric.Shadow({
          color: 'rgba(0,0,0,0.3)',
          blur: 3,
          offsetX: 1,
          offsetY: 1
        })
      });

      // Create name label with background
      const label = new fabric.Text(userName || 'User', {
        left: x + 12,
        top: y - 8,
        fontSize: 11,
        fontFamily: 'Arial, sans-serif',
        fill: '#ffffff',
        backgroundColor: color,
        padding: 4,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        shadow: new fabric.Shadow({
          color: 'rgba(0,0,0,0.2)',
          blur: 2,
          offsetX: 1,
          offsetY: 1
        })
      });

      cursor = { dot, label, lastSeen: Date.now() };
      cursors.set(socketId, cursor);
      canvas.add(dot);
      canvas.add(label);
    } else {
      // Update positions with smooth animation-like updates
      cursor.dot.set({ 
        left: x - 6, 
        top: y - 6,
        fill: color
      });
      
      if (cursor.label) {
        cursor.label.set({ 
          left: x + 12, 
          top: y - 8,
          text: userName || 'User',
          backgroundColor: color
        });
      }
      
      cursor.lastSeen = Date.now();
    }

    safeRender(canvas);
  }, [isActive]);

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

  // Public methods for parent component
  useEffect(() => {
    // Expose methods to parent via ref or callbacks
    const canvas = fabRef.current;
    if (!canvas) return;

    // Method to add a shape from external source (e.g., socket)
    (window as any)[`addShapeToPage_${pageId}`] = (shapeData: any) => {
      // Mark as remote to avoid feedback loop
      shapeData.__remote = true;
      
      fabric.util.enlivenObjects([shapeData], (objects) => {
        const obj = objects[0];
        if (obj && (obj as any).id) {
          canvas.add(obj);
          objectsByIdRef.current.set((obj as any).id, obj);
          safeRender(canvas);
        }
      }, 'fabric');
    };

    (window as any)[`updateShapeInPage_${pageId}`] = (shapeData: any) => {
      const obj = objectsByIdRef.current.get(shapeData.id);
      if (obj) {
        obj.set(shapeData);
        obj.setCoords();
        safeRender(canvas);
      }
    };

    (window as any)[`deleteShapeFromPage_${pageId}`] = (shapeId: string) => {
      const obj = objectsByIdRef.current.get(shapeId);
      if (obj) {
        canvas.remove(obj);
        objectsByIdRef.current.delete(shapeId);
        safeRender(canvas);
      }
    };

    (window as any)[`updateCursorInPage_${pageId}`] = updateRemoteCursor;

    return () => {
      delete (window as any)[`addShapeToPage_${pageId}`];
      delete (window as any)[`updateShapeInPage_${pageId}`];
      delete (window as any)[`deleteShapeFromPage_${pageId}`];
      delete (window as any)[`updateCursorInPage_${pageId}`];
    };
  }, [pageId, updateRemoteCursor]);

  const toggleGrid = () => {
    const newSettings = {
      backgroundType: backgroundType === 'grid' ? 'blank' : 'grid',
      gridType: backgroundType === 'grid' ? null : 'square',
      gridSize: backgroundType === 'grid' ? null : 20
    };
    onPageSettingsUpdate(newSettings);
  };

  const toggleAxes = () => {
    onPageSettingsUpdate({ showAxes: !showAxes });
  };

  return (
    <div ref={containerRef} className="w-full">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {title}
            {isActive && (
              <span className="ml-2 text-sm text-blue-600 font-normal">(Active)</span>
            )}
          </h3>
        </div>
        
        <div className="flex items-center space-x-2">
          {canEdit && (
            <>
              <button
                onClick={toggleGrid}
                className={`text-xs px-2 py-1 rounded ${
                  backgroundType === 'grid' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                Grid
              </button>
              <button
                onClick={toggleAxes}
                className={`text-xs px-2 py-1 rounded ${
                  showAxes 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                Axes
              </button>
              {!isOnlyPage && (
                <button
                  onClick={onDeletePage}
                  className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Canvas Container */}
      <div className="flex justify-center">
        <div 
          className="bg-white shadow-lg border border-gray-300 rounded-lg overflow-hidden" 
          style={{ width, height }}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
};

export default CanvasPage;

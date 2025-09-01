'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { PAGE_PRESETS, PRESET_LABELS, type PresetKey, type PageCreateRequest } from '@/lib/sizes';
import CanvasPage from '@/components/CanvasPage';
import Toolbar from '@/components/Toolbar';

interface Board {
  id: string;
  title: string;
  owner: {
    id: string;
    name?: string;
    email: string;
  };
  canEdit: boolean;
}

interface BoardPage {
  id: string;
  title: string;
  index: number;
  width: number;
  height: number;
  backgroundType: string;
  gridType?: string;
  gridSize?: number;
  showAxes: boolean;
  assetId?: string;
  pdfPage?: number;
}

type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'latex' | 'eraser';

export default function BoardPage() {
  const params = useParams();
  const router = useRouter();
  const boardId = params.id as string;

  // State
  const [board, setBoard] = useState<Board | null>(null);
  const [pages, setPages] = useState<BoardPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  // Tool state
  const [tool, setTool] = useState<Tool>('select');
  const [fill, setFill] = useState('#000000');
  const [stroke, setStroke] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);

  // New page modal
  const [showNewPageModal, setShowNewPageModal] = useState(false);
  const [newPagePreset, setNewPagePreset] = useState<PresetKey>('A4_P');
  const [newPageCustomWidth, setNewPageCustomWidth] = useState(794);
  const [newPageCustomHeight, setNewPageCustomHeight] = useState(1123);
  const [useCustomSize, setUseCustomSize] = useState(false);

  // Intersection observer for active page detection
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Load board data
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    const shareToken = new URLSearchParams(window.location.search).get('t');
    
    if (!token && !shareToken) {
      router.push('/login');
      return;
    }

    if (userData) {
      setUser(JSON.parse(userData));
    }

    loadBoard();
  }, [boardId, router]);

  const loadBoard = async () => {
    try {
      const shareToken = new URLSearchParams(window.location.search).get('t');
      const boardData = await apiClient.getBoard(boardId, shareToken || undefined);
      setBoard(boardData as any);
      await loadPages();
    } catch (error) {
      console.error('Failed to load board:', error);
      setError('Failed to load board. Please check your permissions.');
    } finally {
      setLoading(false);
    }
  };

  const loadPages = async () => {
    try {
      const pagesData = await apiClient.getPages(boardId);
      setPages(pagesData as any);
      
      // Set first page as active if none selected
      if ((pagesData as any[]).length > 0 && !activePageId) {
        setActivePageId((pagesData as any)[0].id);
      }
    } catch (error) {
      console.error('Failed to load pages:', error);
    }
  };

  // Socket connection
  useEffect(() => {
    if (!board || !activePageId) return;

    const userName = user?.name || user?.email || 'Anonymous';
    const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;

    socketManager.connect(boardId, activePageId, userName, userColor);

    // Socket event handlers
    const handleShapeAdd = (data: any) => {
      if (data.pageId && (window as any)[`addShapeToPage_${data.pageId}`]) {
        (window as any)[`addShapeToPage_${data.pageId}`](data.shape);
      }
    };

    const handleShapeUpdate = (data: any) => {
      if (data.pageId && (window as any)[`updateShapeInPage_${data.pageId}`]) {
        (window as any)[`updateShapeInPage_${data.pageId}`](data.shape);
      }
    };

    const handleShapeDelete = (data: any) => {
      if (data.pageId && (window as any)[`deleteShapeFromPage_${data.pageId}`]) {
        (window as any)[`deleteShapeFromPage_${data.pageId}`](data.shapeId);
      }
    };

    const handleCursorMove = (data: any) => {
      if (data.pageId && (window as any)[`updateCursorInPage_${data.pageId}`]) {
        (window as any)[`updateCursorInPage_${data.pageId}`](
          data.socketId, 
          data.x, 
          data.y, 
          data.userName, 
          data.color
        );
      }
    };

    const handlePageSettingsUpdate = (data: any) => {
      if (data.pageId) {
        setPages(prev => prev.map(page => 
          page.id === data.pageId 
            ? { ...page, ...data.settings }
            : page
        ));
      }
    };

    socketManager.on('shape:add', handleShapeAdd);
    socketManager.on('shape:update', handleShapeUpdate);
    socketManager.on('shape:delete', handleShapeDelete);
    socketManager.on('presence:cursor', handleCursorMove);
    socketManager.on('page:settings:update', handlePageSettingsUpdate);

    return () => {
      socketManager.off('shape:add', handleShapeAdd);
      socketManager.off('shape:update', handleShapeUpdate);
      socketManager.off('shape:delete', handleShapeDelete);
      socketManager.off('presence:cursor', handleCursorMove);
      socketManager.off('page:settings:update', handlePageSettingsUpdate);
      socketManager.disconnect();
    };
  }, [board, activePageId, user]);

  // Intersection observer for active page detection
  useEffect(() => {
    if (pages.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the page with the highest intersection ratio
        let maxRatio = 0;
        let mostVisiblePageId = activePageId;

        entries.forEach((entry) => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostVisiblePageId = entry.target.getAttribute('data-page-id');
          }
        });

        // Switch to the most visible page
        if (mostVisiblePageId && mostVisiblePageId !== activePageId) {
          handlePageChange(mostVisiblePageId);
        }
      },
      {
        threshold: [0.1, 0.3, 0.5, 0.7, 0.9],
        rootMargin: '-10% 0px -10% 0px'
      }
    );

    // Observe all page containers
    pageRefs.current.forEach((element) => {
      if (element && observerRef.current) {
        observerRef.current.observe(element);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [pages, activePageId]);

  const handlePageChange = useCallback((pageId: string) => {
    if (pageId === activePageId) return;

    setActivePageId(pageId);
    
    // Switch socket room
    if (board) {
      socketManager.switchPage(board.id, pageId);
    }
  }, [activePageId, board]);

  const handleCreatePage = async () => {
    if (!board) return;

    try {
      const pageRequest: PageCreateRequest = {
        title: `Page ${pages.length + 1}`,
        index: pages.length,
        size: useCustomSize 
          ? { widthPx: newPageCustomWidth, heightPx: newPageCustomHeight }
          : { preset: newPagePreset },
        background: { type: 'blank' }
      };

      const newPage = await apiClient.createPage(board.id, pageRequest);
      setPages(prev => [...prev, newPage as any]);
      setShowNewPageModal(false);

      // Scroll to new page after a short delay
      setTimeout(() => {
        const newPageElement = pageRefs.current.get((newPage as any).id);
        if (newPageElement) {
          newPageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

    } catch (error) {
      console.error('Failed to create page:', error);
      setError('Failed to create page. Please try again.');
    }
  };

  const handleDeletePage = async (pageId: string) => {
    if (!board || pages.length <= 1) return;

    if (!confirm('Are you sure you want to delete this page?')) return;

    try {
      await apiClient.deletePage(board.id, pageId);
      setPages(prev => {
        const newPages = prev.filter(p => p.id !== pageId);
        // Reindex remaining pages
        return newPages.map((page, index) => ({ ...page, index }));
      });

      // If we deleted the active page, switch to the first remaining page
      if (pageId === activePageId) {
        const remainingPages = pages.filter(p => p.id !== pageId);
        if (remainingPages.length > 0) {
          handlePageChange(remainingPages[0].id);
        }
      }

    } catch (error) {
      console.error('Failed to delete page:', error);
      setError('Failed to delete page. Please try again.');
    }
  };

  const handlePageSettingsUpdate = async (pageId: string, settings: any) => {
    try {
      await apiClient.updatePage(boardId, pageId, settings);
      setPages(prev => prev.map(page => 
        page.id === pageId ? { ...page, ...settings } : page
      ));
    } catch (error) {
      console.error('Failed to update page settings:', error);
    }
  };

  // Shape event handlers
  const handleShapeAdd = useCallback((shape: any) => {
    if (!board?.canEdit || !activePageId) return;
    
    const shapeData = shape.toObject();
    socketManager.emit('shape:add', {
      boardId: board.id,
      pageId: activePageId,
      shape: shapeData
    });
  }, [board, activePageId]);

  const handleShapeUpdate = useCallback((shape: any) => {
    if (!board?.canEdit || !activePageId) return;
    
    const shapeData = shape.toObject();
    socketManager.emit('shape:update', {
      boardId: board.id,
      pageId: activePageId,
      shape: shapeData
    });
  }, [board, activePageId]);

  const handleShapeDelete = useCallback((shape: any) => {
    if (!board?.canEdit || !activePageId) return;
    
    const shapeId = (shape as any).id;
    if (shapeId) {
      socketManager.emit('shape:delete', {
        boardId: board.id,
        pageId: activePageId,
        shapeId
      });
    }
  }, [board, activePageId]);

  const handleCursorMove = useCallback((x: number, y: number) => {
    if (!board || !activePageId) return;
    
    socketManager.emit('presence:cursor', {
      boardId: board.id,
      pageId: activePageId,
      x,
      y
    });
  }, [board, activePageId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error || 'Board not found'}</p>
          <button
            onClick={() => router.push('/')}
            className="btn btn-primary"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/')}
                className="text-gray-600 hover:text-gray-900"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-xl font-semibold text-gray-900">{board.title}</h1>
              {!board.canEdit && (
                <span className="text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                  View Only
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {user?.name || user?.email || 'Anonymous'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Toolbar
            tool={tool}
            onToolChange={setTool}
            fill={fill}
            onFillChange={setFill}
            stroke={stroke}
            onStrokeChange={setStroke}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={setStrokeWidth}
            canEdit={board.canEdit}
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-4 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Pages */}
        <div className="space-y-12">
          {pages.map((page, index) => (
            <div
              key={page.id}
              ref={(el) => {
                if (el) {
                  pageRefs.current.set(page.id, el);
                } else {
                  pageRefs.current.delete(page.id);
                }
              }}
              data-page-id={page.id}
              className="w-full"
            >
              <CanvasPage
                pageId={page.id}
                boardId={boardId}
                canEdit={board.canEdit}
                width={page.width}
                height={page.height}
                title={page.title}
                backgroundType={page.backgroundType}
                gridType={page.gridType}
                gridSize={page.gridSize}
                showAxes={page.showAxes}
                tool={tool}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                onShapeAdd={handleShapeAdd}
                onShapeUpdate={handleShapeUpdate}
                onShapeDelete={handleShapeDelete}
                onCursorMove={handleCursorMove}
                onPageSettingsUpdate={(settings) => handlePageSettingsUpdate(page.id, settings)}
                onDeletePage={() => handleDeletePage(page.id)}
                isActive={page.id === activePageId}
                isOnlyPage={pages.length === 1}
              />
            </div>
          ))}
        </div>

        {/* Add Page Button */}
        {board.canEdit && (
          <div className="mt-12 text-center">
            <button
              onClick={() => setShowNewPageModal(true)}
              className="btn btn-primary"
            >
              + Add Page
            </button>
          </div>
        )}
      </main>

      {/* New Page Modal */}
      {showNewPageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-6">Add New Page</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Page Size
                </label>
                <div className="space-y-3">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={!useCustomSize}
                      onChange={() => setUseCustomSize(false)}
                      className="mr-2"
                    />
                    <span>Preset Size</span>
                  </label>
                  {!useCustomSize && (
                    <select
                      value={newPagePreset}
                      onChange={(e) => setNewPagePreset(e.target.value as PresetKey)}
                      className="w-full border border-gray-300 rounded px-3 py-2 ml-6"
                    >
                      {Object.entries(PRESET_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  )}
                  
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={useCustomSize}
                      onChange={() => setUseCustomSize(true)}
                      className="mr-2"
                    />
                    <span>Custom Size</span>
                  </label>
                  {useCustomSize && (
                    <div className="flex space-x-3 ml-6">
                      <div className="flex-1">
                        <input
                          type="number"
                          value={newPageCustomWidth}
                          onChange={(e) => setNewPageCustomWidth(parseInt(e.target.value) || 794)}
                          placeholder="Width"
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                      <span className="flex items-center">×</span>
                      <div className="flex-1">
                        <input
                          type="number"
                          value={newPageCustomHeight}
                          onChange={(e) => setNewPageCustomHeight(parseInt(e.target.value) || 1123)}
                          placeholder="Height"
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex space-x-3 pt-6">
              <button
                onClick={() => setShowNewPageModal(false)}
                className="flex-1 btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePage}
                className="flex-1 btn btn-primary"
              >
                Add Page
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

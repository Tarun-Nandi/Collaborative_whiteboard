'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { PAGE_PRESETS, PRESET_LABELS, type PresetKey, type PageCreateRequest, getPageSize } from '@/lib/sizes';

interface Board {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    name?: string;
    email: string;
  };
  _count: {
    events: number;
  };
}

type NewBoardType = 'blank' | 'pdf' | 'image';

export default function Dashboard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [shareLinks, setShareLinks] = useState<Map<string, any>>(new Map());
  
  // New Board Modal State
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardType, setNewBoardType] = useState<NewBoardType>('blank');
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardPreset, setNewBoardPreset] = useState<PresetKey>('A4_P');
  const [newBoardCustomWidth, setNewBoardCustomWidth] = useState(794);
  const [newBoardCustomHeight, setNewBoardCustomHeight] = useState(1123);
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // File input refs
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (!token || !userData) {
      router.push('/login');
      return;
    }

    setUser(JSON.parse(userData));
    loadBoards();
  }, [router]);

  const loadBoards = async () => {
    try {
      const data = await apiClient.getBoards();
      setBoards(data as any);
    } catch (error) {
      console.error('Failed to load boards:', error);
      if (error instanceof Error && error.message.includes('token')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetModal = () => {
    setShowNewBoardModal(false);
    setNewBoardType('blank');
    setNewBoardTitle('');
    setNewBoardPreset('A4_P');
    setUseCustomSize(false);
    setProcessing(false);
    setProcessProgress('');
    setErrorMessage('');
  };

  const createBlankBoard = async () => {
    setProcessing(true);
    setProcessProgress('Creating board...');
    
    try {
      const boardTitle = newBoardTitle.trim() || 'Untitled Board';
      
      // Create the board
      const board = await apiClient.createBoard({ title: boardTitle });
      
      setProcessProgress('Creating page...');
      
      // Create the first page
      const pageRequest: PageCreateRequest = {
        title: 'Page 1',
        index: 0,
        size: useCustomSize 
          ? { widthPx: newBoardCustomWidth, heightPx: newBoardCustomHeight }
          : { preset: newBoardPreset },
        background: { type: 'blank' }
      };
      
      await apiClient.createPage((board as any).id, pageRequest);
      
      // Update local state
      setBoards(prev => [board as any, ...prev]);
      
      // Navigate to the board
      router.push(`/board/${(board as any).id}`);
      
    } catch (error) {
      console.error('Failed to create blank board:', error);
      setErrorMessage('Failed to create board. Please try again.');
      setProcessing(false);
    }
  };

  const createBoardFromPDF = async (file: File) => {
    setProcessing(true);
    setErrorMessage('');
    
    try {
      setProcessProgress('Loading PDF processor...');
      
      // Dynamic import to avoid SSR issues
      const { processPDFFile, renderPdfPageToDataURL, formatPDFError } = await import('@/lib/pdf');
      
      await new Promise<void>((resolve, reject) => {
        processPDFFile(
          file,
          async (pdf) => {
            try {
              const boardTitle = newBoardTitle.trim() || file.name.replace('.pdf', '');
              
              setProcessProgress('Creating board...');
              
              // Create the board
              const board = await apiClient.createBoard({ title: boardTitle });
              
              setProcessProgress(`Processing ${pdf.numPages} pages...`);
              
              // Process each page
              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                setProcessProgress(`Rendering page ${pageNum}/${pdf.numPages}...`);
                
                try {
                  const { width, height } = await renderPdfPageToDataURL(pdf, pageNum, 2.0);
                  
                  const pageRequest: PageCreateRequest = {
                    title: `Page ${pageNum}`,
                    index: pageNum - 1,
                    size: { widthPx: width, heightPx: height },
                    background: { 
                      type: 'pdf',
                      pdfPage: pageNum
                    }
                  };
                  
                  await apiClient.createPage((board as any).id, pageRequest);
                  
                } catch (pageError) {
                  console.error(`Failed to process page ${pageNum}:`, pageError);
                  // Continue with other pages
                }
              }
              
              // Update local state
              setBoards(prev => [board as any, ...prev]);
              
              // Navigate to the board
              router.push(`/board/${(board as any).id}`);
              
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          (error) => {
            setErrorMessage(formatPDFError(error));
            setProcessing(false);
            reject(error);
          }
        );
      });
      
    } catch (error) {
      console.error('Failed to create board from PDF:', error);
      if (!errorMessage) {
        setErrorMessage('Failed to process PDF. Please try again.');
      }
      setProcessing(false);
    }
  };

  const createBoardFromImage = async (file: File) => {
    setProcessing(true);
    setProcessProgress('Processing image...');
    
    try {
      // Load image to get dimensions
      const img = new Image();
      const imageDataURL = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageDataURL;
      });
      
      const boardTitle = newBoardTitle.trim() || file.name.replace(/\.[^/.]+$/, '');
      
      setProcessProgress('Creating board...');
      
      // Create the board
      const board = await apiClient.createBoard({ title: boardTitle });
      
      setProcessProgress('Creating page...');
      
      // Create page with image dimensions
      const pageRequest: PageCreateRequest = {
        title: 'Page 1',
        index: 0,
        size: { widthPx: img.naturalWidth, heightPx: img.naturalHeight },
        background: { type: 'image' }
      };
      
      await apiClient.createPage((board as any).id, pageRequest);
      
      // Update local state
      setBoards(prev => [board as any, ...prev]);
      
      // Navigate to the board
      router.push(`/board/${(board as any).id}`);
      
    } catch (error) {
      console.error('Failed to create board from image:', error);
      setErrorMessage('Failed to process image. Please try again.');
      setProcessing(false);
    }
  };

  const handlePDFSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setErrorMessage('Please select a valid PDF file.');
        return;
      }
      
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        setErrorMessage('PDF file is too large. Please select a file smaller than 50MB.');
        return;
      }
      
      createBoardFromPDF(file);
    }
    
    // Reset input
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrorMessage('Please select a valid image file.');
        return;
      }
      
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        setErrorMessage('Image file is too large. Please select a file smaller than 10MB.');
        return;
      }
      
      createBoardFromImage(file);
    }
    
    // Reset input
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const generateShareLink = async (boardId: string, canEdit: boolean) => {
    try {
      const shareLink = await apiClient.createShareLink(boardId, canEdit);
      setShareLinks(prev => new Map(prev.set(boardId, shareLink as any)));
    } catch (error) {
      console.error('Failed to generate share link:', error);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold text-gray-900">Collaborative Whiteboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {user?.name || user?.email}</span>
              <button onClick={logout} className="btn btn-secondary">
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Your Boards</h2>
          <button
            onClick={() => setShowNewBoardModal(true)}
            className="btn btn-primary"
          >
            New Board
          </button>
        </div>

        {boards.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No boards yet</h3>
            <p className="text-gray-500 mb-6">Create your first whiteboard to start collaborating</p>
            <button
              onClick={() => setShowNewBoardModal(true)}
              className="btn btn-primary"
            >
              Create Your First Board
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {boards.map((board) => (
              <div key={board.id} className="card hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{board.title}</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => generateShareLink(board.id, false)}
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
                      title="Generate view-only share link"
                    >
                      Share (View)
                    </button>
                    <button
                      onClick={() => generateShareLink(board.id, true)}
                      className="text-xs bg-primary-100 hover:bg-primary-200 text-primary-700 px-2 py-1 rounded"
                      title="Generate editable share link"
                    >
                      Share (Edit)
                    </button>
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mb-4">
                  Created by {board.owner.name || board.owner.email}
                </p>
                
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">
                    {board._count.events} changes
                  </span>
                  <button
                    onClick={() => router.push(`/board/${board.id}`)}
                    className="btn btn-primary"
                  >
                    Open
                  </button>
                </div>

                {shareLinks.has(board.id) && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-2">Share link generated:</p>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={`${window.location.origin}/board/${board.id}?t=${shareLinks.get(board.id)?.token}`}
                        readOnly
                        className="input text-xs flex-1"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/board/${board.id}?t=${shareLinks.get(board.id)?.token}`
                          );
                        }}
                        className="btn btn-secondary text-xs"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* New Board Modal */}
      {showNewBoardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-6">Create New Board</h2>
            
            {!processing ? (
              <div className="space-y-6">
                {/* Board Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Board Type
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        checked={newBoardType === 'blank'}
                        onChange={() => setNewBoardType('blank')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Blank Board</div>
                        <div className="text-sm text-gray-600">Start with an empty whiteboard</div>
                      </div>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        checked={newBoardType === 'pdf'}
                        onChange={() => setNewBoardType('pdf')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">From PDF</div>
                        <div className="text-sm text-gray-600">Import PDF pages as board backgrounds</div>
                      </div>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        checked={newBoardType === 'image'}
                        onChange={() => setNewBoardType('image')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">From Image</div>
                        <div className="text-sm text-gray-600">Create board from an image background</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Board Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Board Title
                  </label>
                  <input
                    type="text"
                    value={newBoardTitle}
                    onChange={(e) => setNewBoardTitle(e.target.value)}
                    placeholder={
                      newBoardType === 'blank' ? 'Untitled Board' :
                      newBoardType === 'pdf' ? 'Board title (or use filename)' :
                      'Board title (or use filename)'
                    }
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>

                {/* Size Settings (for blank boards) */}
                {newBoardType === 'blank' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
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
                          value={newBoardPreset}
                          onChange={(e) => setNewBoardPreset(e.target.value as PresetKey)}
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
                              value={newBoardCustomWidth}
                              onChange={(e) => setNewBoardCustomWidth(parseInt(e.target.value) || 794)}
                              placeholder="Width"
                              className="w-full border border-gray-300 rounded px-3 py-2"
                            />
                          </div>
                          <span className="flex items-center">×</span>
                          <div className="flex-1">
                            <input
                              type="number"
                              value={newBoardCustomHeight}
                              onChange={(e) => setNewBoardCustomHeight(parseInt(e.target.value) || 1123)}
                              placeholder="Height"
                              className="w-full border border-gray-300 rounded px-3 py-2"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* File Selection */}
                {newBoardType === 'pdf' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select PDF File
                    </label>
                    <button
                      onClick={() => pdfInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
                    >
                      <div className="text-gray-600">
                        <svg className="mx-auto h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        Click to select PDF file
                      </div>
                    </button>
                  </div>
                )}

                {newBoardType === 'image' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Image File
                    </label>
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
                    >
                      <div className="text-gray-600">
                        <svg className="mx-auto h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Click to select image file
                      </div>
                    </button>
                  </div>
                )}

                {/* Error Message */}
                {errorMessage && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
                    {errorMessage}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex space-x-3 pt-4">
                  <button
                    onClick={resetModal}
                    className="flex-1 btn btn-secondary"
                  >
                    Cancel
                  </button>
                  {newBoardType === 'blank' && (
                    <button
                      onClick={createBlankBoard}
                      className="flex-1 btn btn-primary"
                    >
                      Create Board
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* Processing State */
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-lg font-medium text-gray-900 mb-2">Creating Board</p>
                <p className="text-sm text-gray-600">{processProgress}</p>
                
                {errorMessage && (
                  <div className="mt-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
                    {errorMessage}
                    <button
                      onClick={resetModal}
                      className="ml-4 text-sm underline"
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        onChange={handlePDFSelect}
        className="hidden"
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        className="hidden"
      />
    </div>
  );
}

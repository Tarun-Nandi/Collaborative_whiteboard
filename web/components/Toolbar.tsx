'use client';

import { useState, useRef } from 'react';

type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'latex' | 'eraser';

interface ToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  fill: string;
  onFillChange: (color: string) => void;
  stroke: string;
  onStrokeChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  canEdit: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  onToolChange,
  fill,
  onFillChange,
  stroke,
  onStrokeChange,
  strokeWidth,
  onStrokeWidthChange,
  canEdit
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const toggleDropdown = (dropdown: string) => {
    setActiveDropdown(activeDropdown === dropdown ? null : dropdown);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Image upload will be handled by parent component
      console.log('Image selected:', file.name);
    }
    
    // Reset input
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const handlePDFSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        alert('Please select a valid PDF file.');
        return;
      }
      
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        alert('PDF file is too large. Please select a file smaller than 50MB.');
        return;
      }
      
      // PDF upload will be handled by parent component
      console.log('PDF selected:', file.name);
    }
    
    // Reset input
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  };

  const ToolButton: React.FC<{
    tool: Tool;
    icon: React.ReactNode;
    label: string;
    disabled?: boolean;
  }> = ({ tool: toolType, icon, label, disabled = false }) => (
    <button
      onClick={() => onToolChange(toolType)}
      disabled={disabled || !canEdit}
      className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        tool === toolType
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-700 hover:bg-gray-100'
      } ${disabled || !canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const DropdownButton: React.FC<{
    label: string;
    isActive: boolean;
    children: React.ReactNode;
  }> = ({ label, isActive, children }) => (
    <div className="relative">
      <button
        onClick={() => toggleDropdown(label.toLowerCase())}
        className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-100 text-blue-700'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <span>{label}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {activeDropdown === label.toLowerCase() && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[200px]">
          <div className="p-2 space-y-1">
            {children}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex items-center space-x-4 py-4">
      {/* Draw Tools */}
      <DropdownButton label="Draw" isActive={activeDropdown === 'draw'}>
        <ToolButton
          tool="pen"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          }
          label="Pen"
        />
        <ToolButton
          tool="rect"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth={2} />
            </svg>
          }
          label="Rectangle"
        />
        <ToolButton
          tool="ellipse"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <ellipse cx="12" cy="5" rx="9" ry="3" strokeWidth={2} />
            </svg>
          }
          label="Ellipse"
        />
        <ToolButton
          tool="line"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20L20 4" />
            </svg>
          }
          label="Line"
        />
        <ToolButton
          tool="eraser"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          }
          label="Eraser"
        />
      </DropdownButton>

      {/* Text Tools */}
      <DropdownButton label="Text" isActive={activeDropdown === 'text'}>
        <ToolButton
          tool="text"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          }
          label="Text"
        />
        <ToolButton
          tool="latex"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          label="LaTeX"
        />
      </DropdownButton>

      {/* Insert Tools */}
      <DropdownButton label="Insert" isActive={activeDropdown === 'insert'}>
        <button
          onClick={() => imageInputRef.current?.click()}
          disabled={!canEdit}
          className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            !canEdit ? 'opacity-50 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Image</span>
        </button>
        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={!canEdit}
          className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            !canEdit ? 'opacity-50 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span>PDF</span>
        </button>
      </DropdownButton>

      {/* Select Tool */}
      <ToolButton
        tool="select"
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
        }
        label="Select"
      />

      {/* Separator */}
      <div className="w-px h-8 bg-gray-300" />

      {/* Color Controls */}
      <div className="flex items-center space-x-2">
        <label className="text-sm font-medium text-gray-700">Fill:</label>
        <input
          type="color"
          value={fill}
          onChange={(e) => onFillChange(e.target.value)}
          disabled={!canEdit}
          className="w-8 h-8 rounded border border-gray-300 disabled:opacity-50"
        />
      </div>

      <div className="flex items-center space-x-2">
        <label className="text-sm font-medium text-gray-700">Stroke:</label>
        <input
          type="color"
          value={stroke}
          onChange={(e) => onStrokeChange(e.target.value)}
          disabled={!canEdit}
          className="w-8 h-8 rounded border border-gray-300 disabled:opacity-50"
        />
      </div>

      <div className="flex items-center space-x-2">
        <label className="text-sm font-medium text-gray-700">Width:</label>
        <input
          type="range"
          min="1"
          max="20"
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(parseInt(e.target.value))}
          disabled={!canEdit}
          className="w-20 disabled:opacity-50"
        />
        <span className="text-sm text-gray-600 w-6">{strokeWidth}</span>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        onChange={handlePDFSelect}
        className="hidden"
      />
    </div>
  );
};

export default Toolbar;

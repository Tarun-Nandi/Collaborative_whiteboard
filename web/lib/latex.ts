// LaTeX rendering utility using KaTeX
import 'katex/dist/katex.min.css';

// Dynamic import to avoid SSR issues
let katex: any = null;

const loadKaTeX = async () => {
  if (katex) return katex;
  if (typeof window === 'undefined') return null;
  
  try {
    katex = await import('katex');
    return katex;
  } catch (error) {
    console.error('Failed to load KaTeX:', error);
    return null;
  }
};

export interface LaTeXRenderOptions {
  displayMode?: boolean;
  fontSize?: number;
  color?: string;
}

export const renderLaTeXToSVG = async (
  latex: string, 
  options: LaTeXRenderOptions = {}
): Promise<string | null> => {
  const katexLib = await loadKaTeX();
  if (!katexLib) return null;
  
  try {
    const html = katexLib.renderToString(latex, {
      displayMode: options.displayMode || false,
      throwOnError: false,
      output: 'html'
    });
    
    // Create a temporary div to measure the rendered content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.fontSize = `${options.fontSize || 20}px`;
    tempDiv.style.color = options.color || '#000000';
    document.body.appendChild(tempDiv);
    
    const rect = tempDiv.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    
    // Create SVG with the HTML content
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <foreignObject width="${width}" height="${height}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${options.fontSize || 20}px; color: ${options.color || '#000000'};">
            ${html}
          </div>
        </foreignObject>
      </svg>
    `;
    
    document.body.removeChild(tempDiv);
    
    return svg;
  } catch (error) {
    console.error('LaTeX rendering error:', error);
    return null;
  }
};

export const isValidLaTeX = async (latex: string): Promise<boolean> => {
  const katexLib = await loadKaTeX();
  if (!katexLib) return false;
  
  try {
    katexLib.renderToString(latex, {
      throwOnError: true,
      output: 'html'
    });
    return true;
  } catch {
    return false;
  }
};

export const createLaTeXInput = (
  onConfirm: (latex: string) => void,
  onCancel: () => void,
  initialValue = ''
): HTMLElement => {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    min-width: 400px;
  `;
  
  const title = document.createElement('h3');
  title.textContent = 'Enter LaTeX Formula';
  title.style.cssText = `
    margin: 0 0 15px 0;
    font-size: 18px;
    font-weight: 600;
  `;
  
  const input = document.createElement('textarea');
  input.value = initialValue;
  input.placeholder = 'e.g. x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
  input.style.cssText = `
    width: 100%;
    height: 80px;
    padding: 10px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-family: monospace;
    font-size: 14px;
    resize: vertical;
    margin-bottom: 15px;
  `;
  
  const preview = document.createElement('div');
  preview.style.cssText = `
    min-height: 40px;
    padding: 10px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: #f9fafb;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  const updatePreview = async () => {
    const latex = input.value.trim();
    if (!latex) {
      preview.innerHTML = '<span style="color: #6b7280;">Preview will appear here</span>';
      return;
    }
    
    try {
      const katexLib = await loadKaTeX();
      if (katexLib) {
        const html = katexLib.renderToString(latex, {
          displayMode: true,
          throwOnError: false,
          output: 'html'
        });
        preview.innerHTML = html;
      }
    } catch (error) {
      preview.innerHTML = '<span style="color: #ef4444;">Invalid LaTeX</span>';
    }
  };
  
  input.addEventListener('input', updatePreview);
  
  const buttons = document.createElement('div');
  buttons.style.cssText = `
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  `;
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    cursor: pointer;
  `;
  
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Insert';
  confirmBtn.style.cssText = `
    padding: 8px 16px;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    background: #3b82f6;
    color: white;
    cursor: pointer;
  `;
  
  const cleanup = () => {
    document.body.removeChild(overlay);
  };
  
  cancelBtn.addEventListener('click', () => {
    cleanup();
    onCancel();
  });
  
  confirmBtn.addEventListener('click', () => {
    const latex = input.value.trim();
    if (latex) {
      cleanup();
      onConfirm(latex);
    }
  });
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      cleanup();
      onCancel();
    }
  });
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const latex = input.value.trim();
      if (latex) {
        cleanup();
        onConfirm(latex);
      }
    }
    if (e.key === 'Escape') {
      cleanup();
      onCancel();
    }
  });
  
  dialog.appendChild(title);
  dialog.appendChild(input);
  dialog.appendChild(preview);
  buttons.appendChild(cancelBtn);
  buttons.appendChild(confirmBtn);
  dialog.appendChild(buttons);
  overlay.appendChild(dialog);
  
  // Initialize preview
  updatePreview();
  
  setTimeout(() => input.focus(), 100);
  
  return overlay;
};

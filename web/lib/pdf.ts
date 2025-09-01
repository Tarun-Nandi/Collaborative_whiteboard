'use client';

// Dynamic imports to avoid SSR issues
let pdfjsLib: any = null;

const loadPDFJS = async () => {
  if (pdfjsLib) return pdfjsLib;
  if (typeof window === 'undefined') return null;
  
  try {
    pdfjsLib = await import('pdfjs-dist');
    
    // Configure worker path for Next.js (served from /public)
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    
    return pdfjsLib;
  } catch (error) {
    console.error('Failed to load PDF.js:', error);
    return null;
  }
};

export interface PDFPageRenderResult {
  dataURL: string;
  width: number;
  height: number;
  pageNumber: number;
}

export interface PDFLoadError extends Error {
  type: 'missing-worker' | 'password-required' | 'wrong-password' | 'cors-blocked' | 'corrupted' | 'unknown';
  originalError?: Error;
}

// Load PDF from file with proper error handling
export async function loadPdfFromFile(file: File): Promise<any> {
  const pdfjs = await loadPDFJS();
  if (!pdfjs) {
    const error: PDFLoadError = new Error('PDF.js failed to load') as PDFLoadError;
    error.type = 'missing-worker';
    error.message = 'PDF worker missing (dev): run pnpm -C web postinstall & restart dev.';
    throw error;
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    return pdf;
  } catch (error: any) {
    const pdfError: PDFLoadError = new Error('Failed to load PDF') as PDFLoadError;
    
    if (error.name === 'PasswordException') {
      pdfError.type = 'password-required';
      pdfError.message = 'This PDF requires a password';
    } else if (error.name === 'InvalidPDFException') {
      pdfError.type = 'corrupted';
      pdfError.message = 'This PDF file appears to be corrupted or invalid';
    } else if (error.message?.includes('worker')) {
      pdfError.type = 'missing-worker';
      pdfError.message = 'PDF worker missing (dev): run pnpm -C web postinstall & restart dev.';
    } else {
      pdfError.type = 'unknown';
      pdfError.message = `Failed to process PDF: ${error.message || 'Unknown error'}`;
    }
    
    pdfError.originalError = error;
    throw pdfError;
  }
}

// Load PDF with password support
export async function loadPdfWithPassword(
  file: File, 
  getPassword: () => Promise<string | null>
): Promise<any> {
  const pdfjs = await loadPDFJS();
  if (!pdfjs) {
    const error: PDFLoadError = new Error('PDF.js failed to load') as PDFLoadError;
    error.type = 'missing-worker';
    error.message = 'PDF worker missing (dev): run pnpm -C web postinstall & restart dev.';
    throw error;
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: buffer });
    
    loadingTask.onPassword = async (updatePassword, reason) => {
      // reason === 1: need password, 2: wrong password
      const isRetry = reason === 2;
      const password = await getPassword();
      
      if (password === null) {
        // User cancelled
        throw new Error('Password required');
      }
      
      updatePassword(password);
    };
    
    return await loadingTask.promise;
  } catch (error: any) {
    const pdfError: PDFLoadError = new Error('Failed to load PDF') as PDFLoadError;
    
    if (error.message === 'Password required') {
      pdfError.type = 'password-required';
      pdfError.message = 'Password is required to open this PDF';
    } else if (error.name === 'PasswordException') {
      pdfError.type = 'wrong-password';
      pdfError.message = 'Incorrect password';
    } else {
      pdfError.type = 'unknown';
      pdfError.message = `Failed to process PDF: ${error.message || 'Unknown error'}`;
    }
    
    pdfError.originalError = error;
    throw pdfError;
  }
}

// Render PDF page to high-quality data URL
export async function renderPdfPageToDataURL(
  pdf: any, 
  pageNumber: number, 
  scale: number = 2.0
): Promise<PDFPageRenderResult> {
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    } as any;
    
    await page.render(renderContext).promise;
    
    return {
      dataURL: canvas.toDataURL('image/png', 0.95),
      width: canvas.width,
      height: canvas.height,
      pageNumber
    };
  } catch (error: any) {
    throw new Error(`Failed to render page ${pageNumber}: ${error.message}`);
  }
}

// Create password prompt dialog
function createPasswordDialog(isRetry: boolean = false): Promise<string | null> {
  return new Promise((resolve) => {
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
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      min-width: 400px;
    `;

    const title = document.createElement('h3');
    title.textContent = isRetry ? 'Incorrect Password' : 'Password Required';
    title.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
      color: ${isRetry ? '#dc2626' : '#1f2937'};
    `;

    const message = document.createElement('p');
    message.textContent = isRetry 
      ? 'The password you entered is incorrect. Please try again.'
      : 'This PDF is password protected. Please enter the password to continue.';
    message.style.cssText = `
      margin: 0 0 16px 0;
      color: #6b7280;
    `;

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Enter password';
    input.style.cssText = `
      width: 100%;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      margin-bottom: 16px;
      box-sizing: border-box;
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    `;

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.cssText = `
      padding: 10px 20px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      font-weight: 500;
    `;

    const submitButton = document.createElement('button');
    submitButton.textContent = 'Open PDF';
    submitButton.style.cssText = `
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      background: #3b82f6;
      color: white;
      cursor: pointer;
      font-weight: 500;
    `;

    const cleanup = () => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    };

    const handleSubmit = () => {
      const password = input.value.trim();
      if (password) {
        cleanup();
        resolve(password);
      }
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    cancelButton.addEventListener('click', handleCancel);
    submitButton.addEventListener('click', handleSubmit);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    });

    // Close on outside click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleCancel();
      }
    });

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(input);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);

    document.body.appendChild(overlay);
    input.focus();
  });
}

// Main PDF processing function with all error handling
export async function processPDFFile(
  file: File, 
  onSuccess: (pdf: any) => void,
  onError: (error: PDFLoadError) => void
): Promise<void> {
  try {
    // First try without password
    const pdf = await loadPdfFromFile(file);
    onSuccess(pdf);
  } catch (error: any) {
    if (error.type === 'password-required') {
      // Try with password prompt
      try {
        let attempts = 0;
        const getPassword = async (): Promise<string | null> => {
          attempts++;
          const isRetry = attempts > 1;
          return await createPasswordDialog(isRetry);
        };
        
        const pdf = await loadPdfWithPassword(file, getPassword);
        onSuccess(pdf);
      } catch (passwordError: any) {
        onError(passwordError as PDFLoadError);
      }
    } else {
      onError(error as PDFLoadError);
    }
  }
}

// Helper function to format error messages for user display
export function formatPDFError(error: PDFLoadError): string {
  switch (error.type) {
    case 'missing-worker':
      return '❌ PDF worker missing (dev): run pnpm -C web postinstall & restart dev.';
    case 'password-required':
      return '🔒 This PDF requires a password to open.';
    case 'wrong-password':
      return '❌ Incorrect password. Please try again.';
    case 'corrupted':
      return '❌ This PDF file appears to be corrupted or invalid.';
    case 'cors-blocked':
      return '❌ Cannot access this PDF due to security restrictions. Try uploading the file directly.';
    default:
      return `❌ Failed to process PDF: ${error.message}`;
  }
}

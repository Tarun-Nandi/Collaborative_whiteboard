// Page size presets and utilities

export const PAGE_PRESETS = {
  A4_P: { w: 794, h: 1123 },   // A4 Portrait
  A4_L: { w: 1123, h: 794 },   // A4 Landscape
  Letter_P: { w: 816, h: 1056 }, // Letter Portrait
  Letter_L: { w: 1056, h: 816 }, // Letter Landscape
} as const;

export const PRESET_LABELS = {
  A4_P: 'A4 Portrait',
  A4_L: 'A4 Landscape', 
  Letter_P: 'Letter Portrait',
  Letter_L: 'Letter Landscape',
} as const;

export type PresetKey = keyof typeof PAGE_PRESETS;

export interface PageCreateRequest {
  title?: string;
  index?: number;
  size?: {
    preset?: PresetKey;
    orientation?: 'portrait' | 'landscape';
    widthPx?: number;
    heightPx?: number;
  };
  background?: {
    type?: 'blank' | 'grid' | 'pdf' | 'image';
    gridType?: 'square' | 'dot';
    gridSize?: number;
    showAxes?: boolean;
    assetId?: string;
    pdfPage?: number;
  };
}

export function getPageSize(request: PageCreateRequest): { width: number; height: number } {
  if (request.size?.widthPx && request.size?.heightPx) {
    return { width: request.size.widthPx, height: request.size.heightPx };
  }
  
  const preset = request.size?.preset || 'A4_P';
  const dimensions = PAGE_PRESETS[preset];
  
  return { width: dimensions.w, height: dimensions.h };
}

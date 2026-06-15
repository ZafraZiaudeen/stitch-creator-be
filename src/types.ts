export interface GenerateSettings {
  width: number;
  maxColors: number;
  fabricCount: number;
  fitMode: "contain" | "cover";
  crop?: { x: number; y: number; width: number; height: number } | null;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  detailStrength: number;
  ditherMode: "none" | "floyd-steinberg";
}

export interface PatternPaletteEntry {
  code: string;
  name: string;
  r: number;
  g: number;
  b: number;
  count: number;
  symbol: string;
}

export interface GeneratedPattern {
  width: number;
  height: number;
  cells: number[];
  palette: PatternPaletteEntry[];
  previewDataUrl: string;
  metadata: {
    engine: string;
    sourceWidth: number;
    sourceHeight: number;
    resizedWidth: number;
    resizedHeight: number;
    maxColors: number;
    ditherMode: GenerateSettings["ditherMode"];
    detailStrength: number;
    sharpness: number;
  };
}

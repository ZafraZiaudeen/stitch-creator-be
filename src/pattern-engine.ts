import sharp from "sharp";
import { DMC_COLORS } from "./data/dmc.ts";
import { ciede2000, rgbToLab, type Lab } from "./color/lab.ts";
import type {
  GeneratedPattern,
  GenerateSettings,
  PatternPaletteEntry,
} from "./types.ts";

const SYMBOLS = [
  "●",
  "■",
  "▲",
  "◆",
  "★",
  "♥",
  "♦",
  "♣",
  "♠",
  "✦",
  "✚",
  "✱",
  "✪",
  "✿",
  "❀",
  "❤",
  "✓",
  "✗",
  "◐",
  "◑",
  "◒",
  "◓",
  "□",
  "△",
  "○",
  "▽",
  "◇",
  "☆",
  "♡",
  "♢",
  "▣",
  "▤",
  "▥",
  "▦",
  "▧",
  "▨",
  "▩",
  "▪",
  "▫",
  "◘",
  "◙",
  "◚",
  "◛",
  "◜",
  "◝",
  "◞",
  "◟",
  "◠",
  "◡",
  "◢",
  "◣",
  "◤",
  "◥",
  "◦",
  "◧",
  "◨",
  "◩",
  "◪",
  "◫",
  "◬",
  "◭",
  "◮",
  "◯",
  "◰",
  "◱",
  "◲",
  "◳",
  "◴",
  "◵",
  "◶",
  "◷",
  "◸",
  "◹",
  "◺",
  "◻",
  "◼",
  "◽",
  "◾",
  "☀",
  "☁",
  "☂",
  "☃",
  "☄",
  "☎",
  "☑",
  "☒",
  "☓",
  "☕",
  "☘",
  "☙",
  "✄",
  "✆",
  "✈",
  "✉",
  "✌",
  "✍",
  "✎",
  "✏",
  "✐",
  "✑",
];

const DMC_LAB = DMC_COLORS.map((c) => rgbToLab(c.r, c.g, c.b));

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

export function parseGenerateSettings(
  fields: Record<string, unknown>,
): GenerateSettings {
  let crop: GenerateSettings["crop"] = null;
  if (typeof fields.crop === "string" && fields.crop.trim()) {
    try {
      const parsed = JSON.parse(fields.crop);
      crop = {
        x: parseNumber(parsed.x, 0, 0, 1),
        y: parseNumber(parsed.y, 0, 0, 1),
        width: parseNumber(parsed.width, 1, 0.05, 1),
        height: parseNumber(parsed.height, 1, 0.05, 1),
      };
    } catch {
      crop = null;
    }
  }

  const ditherMode = fields.ditherMode === "none" ? "none" : "floyd-steinberg";
  const fitMode = fields.fitMode === "cover" ? "cover" : "contain";

  return {
    width: Math.round(parseNumber(fields.width, 220, 20, 800)),
    maxColors: Math.round(parseNumber(fields.maxColors, 95, 2, 180)),
    fabricCount: Math.round(parseNumber(fields.fabricCount, 14, 6, 32)),
    fitMode,
    crop,
    brightness: parseNumber(fields.brightness, 0, -1, 1),
    contrast: parseNumber(fields.contrast, 0, -1, 1),
    saturation: parseNumber(fields.saturation, 0.05, -1, 1),
    sharpness: parseNumber(fields.sharpness, 0.65, 0, 2),
    detailStrength: parseNumber(fields.detailStrength, 0.75, 0, 2),
    ditherMode,
  };
}

function nearestDmcIndex(lab: Lab, allowed?: number[]) {
  let best = 0;
  let bestDistance = Infinity;
  const indexes = allowed ?? DMC_LAB.map((_, index) => index);
  for (const dmcIndex of indexes) {
    const distance = ciede2000(lab, DMC_LAB[dmcIndex]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dmcIndex;
    }
  }
  return best;
}

function buildEdgeWeights(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  detailStrength: number,
) {
  const weights = new Float32Array(width * height);
  const luma = new Float32Array(width * height);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    luma[px] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const left = x > 0 ? luma[idx - 1] : luma[idx];
      const right = x < width - 1 ? luma[idx + 1] : luma[idx];
      const up = y > 0 ? luma[idx - width] : luma[idx];
      const down = y < height - 1 ? luma[idx + width] : luma[idx];
      const edge = Math.min(
        1,
        (Math.abs(right - left) + Math.abs(down - up)) / 96,
      );
      weights[idx] = 1 + edge * detailStrength * 4;
    }
  }
  return weights;
}

function choosePalette(
  nearest: Int16Array,
  weights: Float32Array,
  maxColors: number,
  width: number,
  height: number,
) {
  const weightedCounts = new Map<number, number>();
  const edgeCounts = new Map<number, number>();
  for (let i = 0; i < nearest.length; i++) {
    const dmcIndex = nearest[i];
    if (dmcIndex < 0) continue;
    const weight = weights[i];
    weightedCounts.set(dmcIndex, (weightedCounts.get(dmcIndex) ?? 0) + weight);
    if (weight > 2.4)
      edgeCounts.set(dmcIndex, (edgeCounts.get(dmcIndex) ?? 0) + weight);
  }

  const keep = new Set(
    [...weightedCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(([dmcIndex]) => dmcIndex),
  );

  const edgeBudget = Math.max(4, Math.floor(maxColors * 0.18));
  for (const [dmcIndex] of [...edgeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, edgeBudget)) {
    keep.add(dmcIndex);
  }

  while (keep.size > maxColors) {
    const removable = [...keep].sort(
      (a, b) => (weightedCounts.get(a) ?? 0) - (weightedCounts.get(b) ?? 0),
    )[0];
    keep.delete(removable);
  }

  if (keep.size === 0) keep.add(nearestDmcIndex(rgbToLab(255, 255, 255)));

  return [...keep].sort(
    (a, b) => (weightedCounts.get(b) ?? 0) - (weightedCounts.get(a) ?? 0),
  );
}

function quantizeToPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  paletteDmcIndexes: number[],
  ditherMode: GenerateSettings["ditherMode"],
) {
  const work = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    work[j] = data[i];
    work[j + 1] = data[i + 1];
    work[j + 2] = data[i + 2];
  }

  const cells = new Int16Array(width * height);
  const counts = new Array(paletteDmcIndexes.length).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const off = idx * 3;
      const alpha = data[idx * 4 + 3];
      if (alpha < 32) {
        cells[idx] = -1;
        continue;
      }
      const r = clamp(work[off], 0, 255);
      const g = clamp(work[off + 1], 0, 255);
      const b = clamp(work[off + 2], 0, 255);
      const dmcIndex = nearestDmcIndex(rgbToLab(r, g, b), paletteDmcIndexes);
      const paletteIndex = paletteDmcIndexes.indexOf(dmcIndex);
      cells[idx] = paletteIndex;
      counts[paletteIndex]++;

      if (ditherMode === "floyd-steinberg") {
        const dmc = DMC_COLORS[dmcIndex];
        const er = r - dmc.r;
        const eg = g - dmc.g;
        const eb = b - dmc.b;
        const push = (xx: number, yy: number, weight: number) => {
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) return;
          const o = (yy * width + xx) * 3;
          work[o] += er * weight;
          work[o + 1] += eg * weight;
          work[o + 2] += eb * weight;
        };
        push(x + 1, y, 7 / 16);
        push(x - 1, y + 1, 3 / 16);
        push(x, y + 1, 5 / 16);
        push(x + 1, y + 1, 1 / 16);
      }
    }
  }

  return { cells, counts };
}

function makePreview(
  width: number,
  height: number,
  cells: Int16Array,
  palette: PatternPaletteEntry[],
) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < cells.length; i++) {
    const off = i * 4;
    const paletteIndex = cells[i];
    if (paletteIndex < 0) {
      rgba[off] = 255;
      rgba[off + 1] = 255;
      rgba[off + 2] = 255;
      rgba[off + 3] = 0;
      continue;
    }
    const color = palette[paletteIndex];
    rgba[off] = color.r;
    rgba[off + 1] = color.g;
    rgba[off + 2] = color.b;
    rgba[off + 3] = 255;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize({
      width: Math.min(900, width * 4),
      kernel: sharp.kernel.nearest,
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

export async function generatePatternFromImage(
  image: Buffer,
  settings: GenerateSettings,
): Promise<GeneratedPattern> {
  const input = sharp(image, { failOn: "none" }).rotate();
  const metadata = await input.metadata();
  const sourceWidth = metadata.width ?? settings.width;
  const sourceHeight = metadata.height ?? settings.width;

  let pipeline = input;
  if (settings.crop) {
    const left = Math.floor(sourceWidth * settings.crop.x);
    const top = Math.floor(sourceHeight * settings.crop.y);
    const width = Math.max(1, Math.floor(sourceWidth * settings.crop.width));
    const height = Math.max(1, Math.floor(sourceHeight * settings.crop.height));
    pipeline = pipeline.extract({
      left: clamp(left, 0, sourceWidth - 1),
      top: clamp(top, 0, sourceHeight - 1),
      width: Math.min(width, sourceWidth - left),
      height: Math.min(height, sourceHeight - top),
    });
  }

  const cropMetadata = await pipeline.metadata();
  const cropWidth = cropMetadata.width ?? sourceWidth;
  const cropHeight = cropMetadata.height ?? sourceHeight;
  const targetWidth = settings.width;
  const targetHeight = Math.max(
    1,
    Math.round(targetWidth * (cropHeight / cropWidth)),
  );
  const brightnessOffset = settings.brightness * 18;
  const contrastMultiplier = 1 + settings.contrast * 0.35;

  const { data, info } = await pipeline
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: settings.fitMode,
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false,
    })
    .modulate({ saturation: 1 + settings.saturation * 0.7 })
    .linear(contrastMultiplier, brightnessOffset)
    .sharpen({
      sigma: 0.7 + settings.sharpness * 0.55,
      m1: 0.7 + settings.sharpness,
      m2: 1.2 + settings.sharpness,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );
  const nearest = new Int16Array(info.width * info.height);
  const weights = buildEdgeWeights(
    pixels,
    info.width,
    info.height,
    settings.detailStrength,
  );
  for (let i = 0; i < pixels.length; i += 4) {
    const idx = i / 4;
    if (pixels[i + 3] < 32) {
      nearest[idx] = -1;
      continue;
    }
    nearest[idx] = nearestDmcIndex(
      rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]),
    );
  }

  const paletteDmcIndexes = choosePalette(
    nearest,
    weights,
    settings.maxColors,
    info.width,
    info.height,
  );
  const { cells, counts } = quantizeToPalette(
    pixels,
    info.width,
    info.height,
    paletteDmcIndexes,
    settings.ditherMode,
  );

  const palette = paletteDmcIndexes.map((dmcIndex, index) => ({
    code: DMC_COLORS[dmcIndex].code,
    name: DMC_COLORS[dmcIndex].name,
    r: DMC_COLORS[dmcIndex].r,
    g: DMC_COLORS[dmcIndex].g,
    b: DMC_COLORS[dmcIndex].b,
    count: counts[index],
    symbol: SYMBOLS[index % SYMBOLS.length],
  }));

  const order = palette
    .map((entry, index) => ({ index, count: entry.count }))
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.index);
  const orderMap = new Map<number, number>();
  order.forEach((oldIndex, newIndex) => orderMap.set(oldIndex, newIndex));
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell >= 0) cells[i] = orderMap.get(cell) ?? 0;
  }
  const sortedPalette = order.map((oldIndex, newIndex) => ({
    ...palette[oldIndex],
    symbol: SYMBOLS[newIndex % SYMBOLS.length],
  }));

  const preview = await makePreview(
    info.width,
    info.height,
    cells,
    sortedPalette,
  );

  return {
    width: info.width,
    height: info.height,
    cells: Array.from(cells),
    palette: sortedPalette,
    previewDataUrl: `data:image/png;base64,${preview.toString("base64")}`,
    metadata: {
      engine: "sharp-edge-weighted-dmc-v1",
      sourceWidth,
      sourceHeight,
      resizedWidth: info.width,
      resizedHeight: info.height,
      maxColors: settings.maxColors,
      ditherMode: settings.ditherMode,
      detailStrength: settings.detailStrength,
      sharpness: settings.sharpness,
    },
  };
}

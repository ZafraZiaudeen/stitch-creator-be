import cors from "cors";
import express from "express";
import multer from "multer";
import {
  generatePatternFromImage,
  parseGenerateSettings,
} from "./pattern-engine.ts";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const allowedOrigins: (string | RegExp)[] = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  /\.vercel\.app$/, // Allow any Vercel preview/production deployments
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/api/patterns/generate",
  upload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Image file is required." });
        return;
      }
      const settings = parseGenerateSettings(req.body);
      const pattern = await generatePatternFromImage(req.file.buffer, settings);
      res.json(pattern);
    } catch (error) {
      next(error);
    }
  },
);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    res.status(500).json({ error: message });
  },
);

const port = Number(process.env.PORT ?? 4100);
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`stitch-creator backend listening on http://127.0.0.1:${port}`);
  });
}

export default app;

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const ALLOWED_BUCKETS = ['post-images', 'dm-images', 'dm-audio', 'project-images', 'profile-avatars', 'room-files'];

// Ensure upload directories exist
for (const bucket of ALLOWED_BUCKETS) {
  const dir = path.join(UPLOADS_DIR, bucket);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const bucket = req.params.bucket as string;
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return cb(new Error(`Invalid bucket: ${bucket}`), '');
    }
    cb(null, path.join(UPLOADS_DIR, bucket));
  },
  filename: (req, file, cb) => {
    // Use the provided path or generate a unique filename
    const providedPath = req.body.path || req.query.path;
    if (providedPath) {
      // Sanitize the path to prevent directory traversal
      const safePath = String(providedPath).replace(/\.\./g, '').replace(/^\//, '');
      // Ensure subdirectory exists if path contains /
      if (safePath.includes('/')) {
        const bucket = req.params.bucket as string;
        const fullDir = path.join(UPLOADS_DIR, bucket, path.dirname(safePath));
        if (!fs.existsSync(fullDir)) {
          fs.mkdirSync(fullDir, { recursive: true });
        }
      }
      cb(null, safePath);
    } else {
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `${uuidv4()}${ext}`);
    }
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  }
});

// POST /api/storage/:bucket/upload - Upload file
router.post('/:bucket/upload', (req: Request<{ bucket: string }>, res: Response, next) => {
  const startTime = Date.now();
  console.log(`📤 Upload request received: bucket=${req.params.bucket}, content-length=${req.headers['content-length'] || 'unknown'}`);

  // Handle multer errors (e.g. file too large)
  upload.single('file')(req, res, (err) => {
    if (err) {
      const elapsed = Date.now() - startTime;
      console.error(`❌ Upload multer error after ${elapsed}ms:`, err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 50MB)', message: 'File too large (max 50MB)' });
      }
      return res.status(500).json({ error: err.message, message: err.message });
    }

    const { bucket } = req.params;

    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const elapsed = Date.now() - startTime;
    const filePath = req.file.filename;
    const publicUrl = `/api/storage/${bucket}/${filePath}`;
    const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

    console.log(`✅ Upload success: ${bucket}/${filePath} (${sizeMB} MB, ${elapsed}ms)`);

    return res.json({
      data: {
        path: filePath,
        fullPath: `${bucket}/${filePath}`,
        publicUrl
      },
      error: null
    });
  });
});

// GET /api/storage/:bucket/public/:filename - Get public URL (compatibility)
router.get('/:bucket/public/:filename', (req: Request<{ bucket: string; filename: string }>, res: Response) => {
  const { bucket, filename } = req.params;

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }

  return res.json({
    data: {
      publicUrl: `/api/storage/${bucket}/${filename}`
    }
  });
});

// Kinds a stored file may be shown as in the browser. Nothing here can carry a
// script. Everything else — .svg, .html, .htm, .xml, .pdf, anything unknown — is
// handed over as a download of plain bytes (see serveFile).
//
// .aac is here because DMAudioRecorder records it as a fallback and Chat /
// BeingChat play it as a voice message.
const INLINE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif',
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav',
  '.webm', '.mp4', '.mov',
]);

// Helper to serve a file from a bucket given a relative file path
function serveFile(bucket: string, relativePath: string, req: Request, res: Response) {
  // Anyone can upload any file here, and it comes back from the app's OWN origin —
  // the origin whose localStorage holds the signed-in person's keys. A stored file
  // must never be able to run as the app, so on every response:
  //  - nosniff: the browser takes the Content-Type we send and never guesses a page
  //    out of the bytes;
  //  - CSP sandbox: a file opened on its own gets no origin and runs no script.
  //    No default-src, which would stop an image from showing when opened directly.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }
  if (!relativePath) {
    return res.status(400).json({ error: 'No filename provided' });
  }
  const safePath = relativePath.replace(/\.\./g, '');
  const filePath = path.join(UPLOADS_DIR, bucket, safePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  // Only a stored file, never a folder. An upload's `path` can make a folder named
  // like a picture (x.png/index.html); `x.png/` would pass the extension check below
  // and send() would serve the index.html inside it as text/html.
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }
  // Pictures, sound and video display inline. Anything else is a download, and its
  // type is plain bytes — an .svg or .html must not render even when a page fetches
  // it into a blob: URL (the sandbox header does not travel with the blob, the type
  // does). send() keeps a Content-Type that is already set.
  if (!INLINE_EXTENSIONS.has(path.extname(safePath).toLowerCase())) {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  // For audio buckets, force audio/* Content-Type so <audio> elements don't reject
  // the file on devices that refuse video/webm in audio context.
  // Also disable caching to prevent stale Content-Type from being served via 304.
  if (bucket === 'dm-audio' && safePath.endsWith('.webm')) {
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Support Range requests for audio seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', chunkSize);
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(res);
  }
  // index: false — send() never looks for an index file in a folder, whatever reaches it.
  return res.sendFile(filePath, { index: false });
}

// GET /api/storage/:bucket/* - Serve file (supports any subdirectory depth)
router.get('/:bucket/{*filePath}', (req: Request<{ bucket: string; filePath: string | string[] }>, res: Response) => {
  const { bucket, filePath } = req.params;
  // Express 5 wildcard returns array of path segments — join them
  const resolvedPath = Array.isArray(filePath) ? filePath.join('/') : String(filePath);
  return serveFile(bucket, resolvedPath, req, res);
});

// DELETE /api/storage/:bucket/:filename - Delete file
router.delete('/:bucket/:filename', (req: Request<{ bucket: string; filename: string }>, res: Response) => {
  const { bucket, filename } = req.params;

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }

  const safePath = filename.replace(/\.\./g, '');
  const filePath = path.join(UPLOADS_DIR, bucket, safePath);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return res.json({ message: 'File deleted' });
  }

  return res.status(404).json({ error: 'File not found' });
});

export default router;

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
    const bucket = req.params.bucket;
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
        const bucket = req.params.bucket;
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
router.post('/:bucket/upload', upload.single('file'), (req: Request, res: Response) => {
  const { bucket } = req.params;

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const filePath = req.file.filename;
  const publicUrl = `/api/storage/${bucket}/${filePath}`;

  return res.json({
    data: {
      path: filePath,
      fullPath: `${bucket}/${filePath}`,
      publicUrl
    },
    error: null
  });
});

// GET /api/storage/:bucket/public/:filename - Get public URL (compatibility)
router.get('/:bucket/public/:filename', (req: Request, res: Response) => {
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

// Helper to serve a file from a bucket given a relative file path
function serveFile(bucket: string, relativePath: string, res: Response) {
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
  return res.sendFile(filePath);
}

// GET /api/storage/:bucket/* - Serve file (supports any subdirectory depth)
router.get('/:bucket/{*filePath}', (req: Request, res: Response) => {
  const { bucket, filePath } = req.params;
  // Express 5 wildcard returns array of path segments — join them
  const resolvedPath = Array.isArray(filePath) ? filePath.join('/') : String(filePath);
  return serveFile(bucket, resolvedPath, res);
});

// DELETE /api/storage/:bucket/:filename - Delete file
router.delete('/:bucket/:filename', (req: Request, res: Response) => {
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

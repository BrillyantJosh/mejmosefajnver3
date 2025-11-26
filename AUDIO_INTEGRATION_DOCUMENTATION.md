# Audio Recording and Storage Integration - Technical Documentation

## Overview
This document provides complete technical documentation for implementing audio recording, storage, and playback functionality in a web application using Supabase Storage.

---

## 1. SUPABASE SETUP

### 1.1 Storage Bucket Configuration

Create a public storage bucket named `dm-audio`:

```sql
-- Create the dm-audio storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('dm-audio', 'dm-audio', true);
```

**Key Configuration:**
- **Bucket ID**: `dm-audio`
- **Public Access**: `true` (files are publicly accessible via URL)
- **File Organization**: Files are organized by sender/recipient structure: `{sender_pubkey}/{recipient_pubkey}/{filename}`

### 1.2 Storage Policies (Optional - for access control)

If you need access control, add RLS policies:

```sql
-- Allow authenticated users to upload to their own folders
CREATE POLICY "Users can upload to their own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'dm-audio' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access to all files
CREATE POLICY "Public can read audio files"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'dm-audio');

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'dm-audio' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

### 1.3 File Access

Once uploaded, files are accessible via public URL:
```
https://{project-ref}.supabase.co/storage/v1/object/public/dm-audio/{sender_pubkey}/{recipient_pubkey}/{filename}
```

**Example:**
```
https://emimbfrxykvrbrovbrsf.supabase.co/storage/v1/object/public/dm-audio/abc123.../def456.../1234567890_xyz.webm
```

---

## 2. FRONTEND IMPLEMENTATION

### 2.1 Required Libraries

Install these npm packages:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.76.1",
    "react": "^18.3.1",
    "lucide-react": "^0.462.0"
  }
}
```

**Additional UI Components** (if using shadcn/ui):
- Button
- Slider
- Toast notifications

### 2.2 Audio Recording Component

#### Component Structure

Create `DMAudioRecorder.tsx`:

**Key Features:**
1. **Microphone Access**: Requests and manages microphone permissions
2. **Audio Recording**: Records audio using MediaRecorder API
3. **Audio Preview**: Allows playback before sending
4. **Supabase Upload**: Uploads audio blob to storage bucket
5. **Format Detection**: Automatically detects best supported audio format

#### Core Implementation Details

##### 2.2.1 MIME Type Detection

```typescript
const getSupportedMimeType = (): string => {
  const types = [
    'audio/webm;codecs=opus',  // Best compression (Chrome, Firefox)
    'audio/webm',              // General WebM
    'audio/mp4',               // Safari/iOS
    'audio/aac',               // Fallback
    'audio/mpeg'               // MP3 fallback
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return 'audio/webm'; // Default
};
```

**Supported Formats:**
- `.webm` - Primary format (Chrome, Firefox)
- `.mp4` - Safari/iOS compatibility
- `.aac` - Alternative fallback
- `.mp3` - Universal fallback

##### 2.2.2 Recording Configuration

```typescript
const stream = await navigator.mediaDevices.getUserMedia({ 
  audio: {
    echoCancellation: true,    // Remove echo
    noiseSuppression: true,    // Reduce background noise
    autoGainControl: true      // Normalize volume
  }
});

const mediaRecorder = new MediaRecorder(stream, {
  mimeType: getSupportedMimeType(),
  audioBitsPerSecond: 128000  // 128 kbps - good quality
});
```

**Audio Quality Settings:**
- **Bitrate**: 128 kbps (good balance of quality/size)
- **Echo Cancellation**: Enabled
- **Noise Suppression**: Enabled
- **Auto Gain Control**: Enabled

##### 2.2.3 Recording Workflow

**State Management:**
```typescript
const [isRecording, setIsRecording] = useState(false);
const [isUploading, setIsUploading] = useState(false);
const [audioPreview, setAudioPreview] = useState<{
  blob: Blob;
  url: string;
  mimeType: string;
} | null>(null);

const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const chunksRef = useRef<Blob[]>([]);
const streamRef = useRef<MediaStream | null>(null);
```

**Recording Process:**

1. **Start Recording**:
```typescript
const startRecording = async () => {
  // Request microphone access
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {...} });
  streamRef.current = stream;
  chunksRef.current = [];

  const mediaRecorder = new MediaRecorder(stream, {...});
  
  // Collect audio chunks
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunksRef.current.push(e.data);
    }
  };

  // Handle recording completion
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    // Release microphone
    streamRef.current.getTracks().forEach(track => track.stop());
    // Create preview
    const previewUrl = URL.createObjectURL(blob);
    setAudioPreview({ blob, url: previewUrl, mimeType });
  };

  mediaRecorder.start();
  setIsRecording(true);
};
```

2. **Stop Recording**:
```typescript
const stopRecording = () => {
  if (mediaRecorderRef.current && isRecording) {
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  }
};
```

##### 2.2.4 Upload to Supabase

```typescript
const uploadAudio = async (blob: Blob, mimeType: string) => {
  // Validate size (max 10MB)
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('Audio must be smaller than 10MB');
  }

  // Generate unique filename
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(7);
  const extension = mimeType.includes('webm') ? 'webm' : 
                   mimeType.includes('mp4') ? 'mp4' :
                   mimeType.includes('aac') ? 'aac' : 'mp3';
  const fileName = `${timestamp}_${randomStr}.${extension}`;

  // File path structure: sender/recipient/filename
  const filePath = `${senderPubkey}/${recipientPubkey}/${fileName}`;
  
  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from('dm-audio')
    .upload(filePath, blob, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw error;

  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from('dm-audio')
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
};
```

**File Naming Convention:**
```
{timestamp}_{random}.{extension}
```
Example: `1234567890_abc123.webm`

**File Organization:**
```
dm-audio/
  └── {sender_pubkey}/
      └── {recipient_pubkey}/
          ├── 1234567890_abc123.webm
          ├── 1234567891_def456.webm
          └── ...
```

##### 2.2.5 Preview with Playback Controls

```typescript
const [isPlaying, setIsPlaying] = useState(false);
const [currentTime, setCurrentTime] = useState(0);
const [duration, setDuration] = useState(0);
const audioRef = useRef<HTMLAudioElement | null>(null);

const togglePreviewPlay = () => {
  const audio = audioRef.current;
  if (!audio) return;

  if (isPlaying) {
    audio.pause();
  } else {
    audio.play();
  }
  setIsPlaying(!isPlaying);
};

// Render preview UI
<audio
  ref={audioRef}
  src={audioPreview.url}
  preload="metadata"
  onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
  onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
  onEnded={() => setIsPlaying(false)}
/>
```

**Preview UI Elements:**
- Play/Pause button
- Progress slider (seekable)
- Time display (current / duration)
- Send button
- Discard button

### 2.3 Audio Playback Component

#### Component Structure

Create `AudioPlayer.tsx`:

**Key Features:**
1. **Audio Playback**: Play/pause audio from URL
2. **Progress Display**: Show current time and duration
3. **Seek Control**: Allow scrubbing through audio

#### Core Implementation

```typescript
interface AudioPlayerProps {
  audioUrl: string;
}

export function AudioPlayer({ audioUrl }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = (e: Event) => {
      console.error('Audio loading error:', e);
      setIsLoading(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (values: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = values[0];
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="audio-player">
      <button onClick={togglePlay}>
        {isPlaying ? <Pause /> : <Play />}
      </button>
      <Slider
        value={[currentTime]}
        max={duration || 100}
        step={0.1}
        onValueChange={handleSeek}
      />
      <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
    </div>
  );
}
```

### 2.4 Integration in Chat Interface

#### Detecting Audio Messages

```typescript
// Regex to detect audio URLs in messages
const dmAudioRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-audio\/[^\s]+\.(webm|mp4|m4a|aac|mpeg|mp3|wav|ogg)/i;

const renderMessageContent = (content: string) => {
  const dmAudioMatch = content.match(dmAudioRegex);
  
  if (dmAudioMatch) {
    const audioUrl = dmAudioMatch[0];
    const textBeforeAudio = content.substring(0, dmAudioMatch.index).trim();
    const textAfterAudio = content.substring(dmAudioMatch.index! + audioUrl.length).trim();
    
    return (
      <div className="space-y-2">
        {textBeforeAudio && <p>{textBeforeAudio}</p>}
        <AudioPlayer audioUrl={audioUrl} />
        {textAfterAudio && <p>{textAfterAudio}</p>}
      </div>
    );
  }
  
  return <p>{content}</p>;
};
```

#### Display in Conversation List

```typescript
const getLastMessageDisplay = (content: string | undefined) => {
  if (!content) return 'No messages';
  
  const dmAudioRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-audio\/[^\s]+\.(webm|mp4|m4a|aac|mpeg|mp3|wav|ogg)/i;
  
  if (dmAudioRegex.test(content)) {
    return (
      <span className="flex items-center gap-1">
        <Mic className="h-3 w-3" />
        Audio message
      </span>
    );
  }
  
  return content;
};
```

---

## 3. TECHNICAL SPECIFICATIONS

### 3.1 Audio Format Support

| Format | MIME Type | Browser Support | Recommended Use |
|--------|-----------|-----------------|-----------------|
| WebM Opus | `audio/webm;codecs=opus` | Chrome, Firefox | Primary (best compression) |
| WebM | `audio/webm` | Chrome, Firefox | Fallback |
| MP4 | `audio/mp4` | Safari, iOS | iOS/Safari support |
| AAC | `audio/aac` | Most browsers | Alternative |
| MP3 | `audio/mpeg` | All browsers | Universal fallback |

### 3.2 File Size Limits

- **Maximum file size**: 10 MB
- **Recommended bitrate**: 128 kbps
- **Typical file sizes** (at 128 kbps):
  - 1 minute: ~960 KB
  - 5 minutes: ~4.8 MB
  - 10 minutes: ~9.6 MB

### 3.3 URL Pattern

```
https://{project-ref}.supabase.co/storage/v1/object/public/dm-audio/{path}
```

**URL Structure:**
- `{project-ref}`: Supabase project reference ID
- `{path}`: File path in bucket (`sender/recipient/filename`)

**Example:**
```
https://emimbfrxykvrbrovbrsf.supabase.co/storage/v1/object/public/dm-audio/abc123def456/xyz789ghi012/1234567890_abc.webm
```

### 3.4 Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| MediaRecorder API | ✅ | ✅ | ✅ (14.1+) | ✅ |
| WebM Recording | ✅ | ✅ | ❌ | ✅ |
| MP4 Recording | ❌ | ❌ | ✅ | ❌ |
| Audio Playback | ✅ | ✅ | ✅ | ✅ |

---

## 4. DATA FLOW DIAGRAM

```
[User] → [Click Record Button]
   ↓
[Request Microphone Access]
   ↓
[MediaRecorder starts]
   ↓
[Audio chunks collected]
   ↓
[User stops recording]
   ↓
[Create Blob from chunks]
   ↓
[Generate preview URL (Object URL)]
   ↓
[Display preview with playback controls]
   ↓
[User clicks Send]
   ↓
[Upload Blob to Supabase Storage]
   ↓
[Get public URL]
   ↓
[Send message with audio URL]
   ↓
[Recipient sees message]
   ↓
[AudioPlayer component renders]
   ↓
[Audio streams from Supabase]
```

---

## 5. SECURITY CONSIDERATIONS

### 5.1 File Validation

```typescript
// Validate file size
if (blob.size > 10 * 1024 * 1024) {
  throw new Error('Audio must be smaller than 10MB');
}

// Validate MIME type
const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
if (!allowedTypes.some(type => mimeType.includes(type))) {
  throw new Error('Invalid audio format');
}
```

### 5.2 Access Control

- Public bucket allows anyone to access files via URL
- For private audio, set `public: false` and implement signed URLs
- Use RLS policies for write operations

### 5.3 CORS Configuration

Supabase Storage automatically handles CORS for public buckets.

---

## 6. ERROR HANDLING

### 6.1 Common Errors

```typescript
// Microphone access denied
try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
} catch (error) {
  if (error.name === 'NotAllowedError') {
    // User denied microphone permission
  } else if (error.name === 'NotFoundError') {
    // No microphone found
  }
}

// Upload errors
try {
  await supabase.storage.from('dm-audio').upload(...);
} catch (error) {
  if (error.message.includes('size')) {
    // File too large
  } else if (error.message.includes('network')) {
    // Network error
  }
}
```

### 6.2 Retry Logic

```typescript
const uploadWithRetry = async (blob: Blob, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await uploadAudio(blob);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

---

## 7. PERFORMANCE OPTIMIZATION

### 7.1 Audio Compression

- Use Opus codec in WebM for best compression
- Set appropriate bitrate (128 kbps recommended)
- Consider reducing sample rate for voice (24 kHz sufficient)

### 7.2 Lazy Loading

```typescript
// Only load AudioPlayer when needed
const AudioPlayer = lazy(() => import('@/components/AudioPlayer'));

// Use in component
<Suspense fallback={<div>Loading audio...</div>}>
  <AudioPlayer audioUrl={url} />
</Suspense>
```

### 7.3 Memory Management

```typescript
// Clean up Object URLs
useEffect(() => {
  return () => {
    if (audioPreview?.url) {
      URL.revokeObjectURL(audioPreview.url);
    }
  };
}, [audioPreview]);

// Release microphone
streamRef.current?.getTracks().forEach(track => track.stop());
```

---

## 8. TESTING CHECKLIST

- [ ] Microphone permission request works
- [ ] Recording starts and stops correctly
- [ ] Preview plays recorded audio
- [ ] Upload to Supabase succeeds
- [ ] Public URL is accessible
- [ ] AudioPlayer renders and plays audio
- [ ] Seek/scrub functionality works
- [ ] File size validation works
- [ ] Error messages display correctly
- [ ] Memory is cleaned up properly
- [ ] Works on mobile devices
- [ ] Works in different browsers
- [ ] CORS doesn't block requests
- [ ] Handles slow network conditions

---

## 9. TROUBLESHOOTING

### Issue: Microphone not accessible
**Solution**: Check browser permissions, use HTTPS

### Issue: Audio not playing
**Solution**: Verify URL is accessible, check CORS, check file format

### Issue: Upload fails
**Solution**: Check file size, verify bucket exists, check RLS policies

### Issue: Poor audio quality
**Solution**: Increase bitrate, check echo cancellation settings

---

## 10. COMPLETE CODE REFERENCE

See the following files for full implementation:
- `src/components/DMAudioRecorder.tsx` - Recording component
- `src/components/AudioPlayer.tsx` - Playback component
- `src/pages/Chat.tsx` - Integration example

---

**Last Updated**: 2025-01-26  
**Version**: 1.0  
**Supabase Storage API**: v1
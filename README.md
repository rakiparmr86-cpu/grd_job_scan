# GRD Job Scan

`grd_job_scan` is an Expo Go + Python document scanning MVP.

## Features

- Scan a paper document with the phone camera
- Import an existing photo
- Automatic document-edge detection and perspective correction
- Automatic OCR orientation detection where Tesseract can determine it
- Image cleanup / readability enhancement
- English OCR
- English + Hindi OCR when Hindi language data is installed
- Multiple pages per document
- Review and edit OCR text before export
- Export all pages into one editable Microsoft Word `.docx`
- Share the generated Word file from the phone

## Architecture

```text
Expo Go mobile app
       |
       | multipart image upload
       v
FastAPI / Python
       |
       +-- OpenCV: smart crop / perspective / enhancement
       +-- Tesseract: OCR
       +-- python-docx: Word generation
```

## 1. Run backend locally

### Option A — Docker (recommended)

From the `backend` folder:

```bash
docker build -t grd-job-scan-api .
docker run --rm -p 8000:8000 grd-job-scan-api
```

Test:

```bash
curl http://localhost:8000/health
```

Expected:

```json
{"status":"ok","service":"grd_job_scan"}
```

### Option B — Windows / Python directly

1. Install Python 3.11 or 3.12.
2. Install Tesseract OCR for Windows.
3. Make sure `tesseract.exe` is available on PATH.
4. Install Python dependencies:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

For Hindi OCR, install the Hindi Tesseract language data (`hin.traineddata`) in the Tesseract `tessdata` directory.

## 2. Find the PC LAN IP

On Windows:

```powershell
ipconfig
```

Look for the active Wi-Fi adapter's IPv4 address, for example:

```text
192.168.1.25
```

## 3. Configure the Expo app

Open:

```text
frontend/src_config.js
```

Change:

```js
export const API_BASE_URL = 'http://192.168.1.10:8000';
```

to your PC IP, for example:

```js
export const API_BASE_URL = 'http://192.168.1.25:8000';
```

Do **not** use `localhost` when Expo Go is running on your phone.

## 4. Run frontend

Use a current Node.js version supported by the selected Expo SDK.

```bash
cd frontend
npm install
npx expo install expo-image-picker expo-file-system expo-sharing
npx expo start
```

Open the QR code in Expo Go.

Your phone and backend PC should be on the same Wi-Fi network.

## API

### `POST /api/scan`

Multipart form:

- `file`: image
- `language`: e.g. `eng` or `eng+hin`

Returns:

```json
{
  "scan_id": "...",
  "text": "...",
  "image_url": "/api/scans/.../image"
}
```

### `POST /api/export-word`

```json
{
  "title": "Candidate Documents",
  "pages": [
    {
      "scan_id": "...",
      "text": "Editable OCR text..."
    }
  ]
}
```

### `GET /api/exports/{filename}`

Downloads the generated `.docx`.

## Important production improvements

Before deploying publicly:

- Restrict CORS to your mobile/API domains.
- Add authentication.
- Use object storage (S3/Azure Blob/GCS) instead of local disk.
- Add automatic deletion/retention rules for candidate documents.
- Encrypt stored files and transport everything over HTTPS.
- Add upload size/type validation.
- Add audit logs.
- Add OCR confidence reporting.
- Add background job processing for large batches.
- Add database persistence for document metadata.
- Add job/candidate IDs so a scan can attach directly to a GRD recruitment record.
- Consider cloud OCR for difficult tables/forms if higher accuracy is required.

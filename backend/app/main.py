from __future__ import annotations

import difflib
import io
import logging
import uuid
from pathlib import Path
from typing import List, Literal
from xml.sax.saxutils import escape as xml_escape

import cv2
import easyocr
import numpy as np
import torch
from docx import Document
from docx.shared import Pt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image as PILImage
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

try:
    import pillow_heif

    pillow_heif.register_heif_opener()  # lets Pillow open iPhone HEIC/HEIF photos
except ImportError:
    pillow_heif = None

from app.auth import current_user, router as auth_router

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
TEXT_EXTENSIONS = {".txt", ".csv", ".md", ".json", ".log"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif"}

BASE_DIR = Path(__file__).resolve().parent.parent
SCAN_DIR = BASE_DIR / "data" / "scans"
EXPORT_DIR = BASE_DIR / "data" / "exports"
VOCAB_PATH = BASE_DIR / "data" / "vocabulary.txt"
SCAN_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def load_vocabulary() -> List[str]:
    if not VOCAB_PATH.exists():
        return []
    words = []
    for line in VOCAB_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            words.append(line)
    return words


# Re-read on every request (not cached): editing the file takes effect on the
# next scan with no server restart needed, and the list is small (a text-file
# read is cheap next to the OCR work already happening in the same request).
def correct_with_vocabulary(text: str, cutoff: float = 0.6) -> str:
    vocabulary = load_vocabulary()
    if not vocabulary:
        return text
    match = difflib.get_close_matches(text, vocabulary, n=1, cutoff=cutoff)
    return match[0] if match else text

# Loaded once at startup (not per request), both kept in memory:
#  - EasyOCR: used only for its text *detection* (finding line bounding boxes).
#    verbose=False avoids a Unicode progress-bar character that crashes on
#    Windows consoles using the cp1252 codepage.
#  - TrOCR: reads each detected line. It's a real vision+language transformer
#    (trained on handwritten text), so it uses linguistic context to resolve
#    ambiguous strokes -- e.g. it will read "Received" not "Recieved" -- unlike
#    EasyOCR's CRNN recognizer, which matches character shapes with no
#    language model behind it.
_ocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)

_TROCR_MODEL_NAME = "microsoft/trocr-base-handwritten"
_trocr_processor = TrOCRProcessor.from_pretrained(_TROCR_MODEL_NAME)
_trocr_model = VisionEncoderDecoderModel.from_pretrained(_TROCR_MODEL_NAME)
_trocr_model.eval()

MAX_OCR_LINES = 60  # safety cap so a noisy/busy photo can't stall a request for minutes

app = FastAPI(
    title="Job Scan API",
    version="1.0.0",
    description="Document scanning, enhancement, OCR and Word export API.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

client_logger = logging.getLogger("grd_job_scan.client")
client_logger.setLevel(logging.INFO)
if not client_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s [client] %(message)s", "%H:%M:%S"))
    client_logger.addHandler(_handler)
    client_logger.propagate = False


def identify_client(user_agent: str) -> str:
    """Best-effort label for the server log: 'app' (Expo/React Native) or 'web' (a browser)."""
    ua = user_agent.lower()
    if any(token in ua for token in ("expo", "okhttp", "cfnetwork", "reactnative")):
        return "app"
    if any(token in ua for token in ("mozilla", "chrome", "safari", "firefox", "edg/")):
        return "web"
    return "unknown"


@app.middleware("http")
async def log_client_source(request: Request, call_next):
    # Only worth logging for the file-upload / write endpoints; keep it quiet elsewhere.
    if request.url.path in ("/api/scan", "/api/parse", "/api/export"):
        ua = request.headers.get("user-agent", "")
        client_logger.info(
            "%s %s from %s -> %s (User-Agent: %s)",
            request.method,
            request.url.path,
            request.client.host if request.client else "?",
            identify_client(ua),
            ua or "(none)",
        )
    return await call_next(request)


class ExportPage(BaseModel):
    scan_id: str
    text: str


class ExportRequest(BaseModel):
    title: str = "Job Scan"
    pages: List[ExportPage]
    format: Literal["word", "pdf"] = "word"


EXPORT_MEDIA_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
}


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)

    rect[0] = pts[np.argmin(s)]      # top-left
    rect[2] = pts[np.argmax(s)]      # bottom-right
    rect[1] = pts[np.argmin(diff)]   # top-right
    rect[3] = pts[np.argmax(diff)]   # bottom-left
    return rect


def four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    rect = order_points(pts)
    tl, tr, br, bl = rect

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = max(int(width_a), int(width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = max(int(height_a), int(height_b))

    if max_width < 50 or max_height < 50:
        return image

    dst = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )

    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def smart_crop(image: np.ndarray) -> np.ndarray:
    original = image.copy()

    max_dim = 1400
    h, w = image.shape[:2]
    scale = min(1.0, max_dim / float(max(h, w)))
    resized = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image.copy()

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, None, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    page = None
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            area = cv2.contourArea(approx)
            if area > resized.shape[0] * resized.shape[1] * 0.20:
                page = approx.reshape(4, 2).astype("float32")
                break

    if page is None:
        return original

    page /= scale
    return four_point_transform(original, page)


def enhance_document(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Gentle denoise keeps text edges while reducing camera noise.
    gray = cv2.fastNlMeansDenoising(gray, None, 8, 7, 21)

    # CLAHE improves uneven lighting without destroying all grayscale detail.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Convert back to BGR so JPEG and OCR handling remain simple.
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


# Below this, a "line" is almost always a false-positive detection (blank
# paper, ruled-line noise) rather than real text with low-confidence reading:
# skip it entirely rather than showing junk like "0 0".
OCR_SKIP_CONFIDENCE = 0.30
# Between skip and this, TrOCR's guess might be a hallucination (a fluent-
# sounding but wrong word) rather than a genuine misread: keep the guess but
# flag it so it's not silently trusted.
OCR_FLAG_CONFIDENCE = 0.55


def _read_line_with_confidence(crop: PILImage.Image) -> tuple[str, float]:
    """Run TrOCR on one cropped line. Returns (text, mean token confidence 0-1)."""
    pixel_values = _trocr_processor(images=crop, return_tensors="pt").pixel_values
    with torch.no_grad():
        out = _trocr_model.generate(
            pixel_values, max_new_tokens=64, output_scores=True, return_dict_in_generate=True
        )
    text = _trocr_processor.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()

    # out.sequences includes the leading decoder-start token; out.scores has one
    # entry per *generated* step, aligned with sequences[:, 1:].
    tokenizer = _trocr_processor.tokenizer
    gen_ids = out.sequences[0][1:]
    step_probs = []
    for step_logits, token_id in zip(out.scores, gen_ids):
        if token_id.item() in (tokenizer.pad_token_id, tokenizer.eos_token_id):
            continue
        prob = torch.softmax(step_logits[0], dim=-1)[token_id].item()
        step_probs.append(prob)
    confidence = sum(step_probs) / len(step_probs) if step_probs else 0.0
    return text, confidence


def run_ocr(image: np.ndarray, language: str) -> str:
    # `language` is accepted for API compatibility but currently ignored: the
    # models loaded at startup are English only (see _ocr_reader / _trocr_model).
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_image = PILImage.fromarray(rgb)

    # EasyOCR just finds where each line of text is; recognition is TrOCR's job.
    horizontal_list, _free_list = _ocr_reader.detect(rgb)
    boxes = horizontal_list[0] if horizontal_list else []
    if not boxes:
        return ""

    height, width = image.shape[:2]
    lines: List[tuple[int, str]] = []
    for x_min, x_max, y_min, y_max in boxes[:MAX_OCR_LINES]:
        x_min, y_min = max(0, x_min), max(0, y_min)
        x_max, y_max = min(width, x_max), min(height, y_max)
        if x_max <= x_min or y_max <= y_min:
            continue

        crop = pil_image.crop((x_min, y_min, x_max, y_max))
        text, confidence = _read_line_with_confidence(crop)
        if not text or confidence < OCR_SKIP_CONFIDENCE:
            continue  # near-certainly a false-positive detection, not real text
        if confidence < OCR_FLAG_CONFIDENCE:
            # Only touch text we already don't trust -- never override a
            # confident reading. If no vocabulary entry is close enough,
            # correct_with_vocabulary() just returns the text unchanged.
            text = f"[unclear] {correct_with_vocabulary(text)}"
        lines.append((y_min, text))

    lines.sort(key=lambda item: item[0])  # top-to-bottom reading order
    return "\n".join(text for _, text in lines).strip()


def decode_upload(raw: bytes) -> np.ndarray:
    arr = np.frombuffer(raw, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is not None:
        return image

    # OpenCV can't decode some formats phone cameras produce (notably HEIC/HEIF
    # on iPhones). Pillow handles far more formats, and pillow-heif (if installed)
    # adds HEIC/HEIF support specifically.
    try:
        pil_image = PILImage.open(io.BytesIO(raw)).convert("RGB")
        return cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unsupported or invalid image.") from exc


@app.get("/health")
def health():
    return {"status": "ok", "service": "grd_job_scan"}


def process_image(raw: bytes, language: str):
    """Crop, enhance and OCR an image. Returns (enhanced_image, text)."""
    image = decode_upload(raw)

    cropped = smart_crop(image)
    enhanced = enhance_document(cropped)

    try:
        text = run_ocr(enhanced, language)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR failed. Details: {exc}") from exc
    return enhanced, text


async def read_limited(file: UploadFile) -> bytes:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 20 MB.")
    return raw


@app.post("/api/scan")
async def scan_document(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    user: str = Depends(current_user),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    enhanced, text = process_image(await read_limited(file), language)

    scan_id = str(uuid.uuid4())
    output_path = SCAN_DIR / f"{scan_id}.jpg"
    cv2.imwrite(str(output_path), enhanced, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

    return {
        "scan_id": scan_id,
        "text": text,
        "image_url": f"/api/scans/{scan_id}/image",
    }


@app.post("/api/parse")
async def parse_file(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    user: str = Depends(current_user),
):
    """Extract text from an uploaded txt/csv, docx, pdf or image file."""
    name = file.filename or "upload"
    suffix = Path(name).suffix.lower()
    raw = await read_limited(file)

    if suffix in TEXT_EXTENSIONS:
        kind, text = "text", raw.decode("utf-8", errors="replace")
    elif suffix == ".docx":
        try:
            doc = Document(io.BytesIO(raw))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read this .docx file.") from exc
        parts = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                parts.append("\t".join(cell.text.strip() for cell in row.cells))
        kind, text = "docx", "\n\n".join(parts)
    elif suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise HTTPException(
                status_code=501,
                detail="PDF parsing needs the 'pypdf' package on the server (pip install pypdf).",
            ) from exc
        try:
            reader = PdfReader(io.BytesIO(raw))
            text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read this PDF file.") from exc
        kind = "pdf"
    elif suffix in IMAGE_EXTENSIONS or (file.content_type or "").startswith("image/"):
        _, text = process_image(raw, language)
        kind = "image"
    else:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type. Use txt, csv, docx, pdf or an image.",
        )

    text = text.strip()
    return {"filename": name, "type": kind, "text": text, "chars": len(text)}


@app.get("/api/scans/{scan_id}/image")
def get_scan_image(scan_id: str):
    path = SCAN_DIR / f"{scan_id}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Scan not found.")
    return FileResponse(path, media_type="image/jpeg", filename=f"{scan_id}.jpg")


@app.delete("/api/scans/{scan_id}")
def delete_scan(scan_id: str, user: str = Depends(current_user)):
    path = SCAN_DIR / f"{scan_id}.jpg"
    if path.exists():
        path.unlink()
    return {"deleted": True, "scan_id": scan_id}


def split_chunks(text: str) -> List[str]:
    chunks = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n") if p.strip()]
    if not chunks and text.strip():
        chunks = [text.strip()]
    return chunks


def build_word(path: Path, title: str, pages: List[ExportPage]) -> None:
    document = Document()
    document.core_properties.title = title

    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(11)

    document.add_heading(title, level=1)

    for index, page in enumerate(pages, start=1):
        if len(pages) > 1:
            document.add_heading(f"Page {index}", level=2)

        # Keep output editable: OCR text is inserted as real Word paragraphs.
        for chunk in split_chunks(page.text):
            document.add_paragraph(chunk)

        if index < len(pages):
            document.add_page_break()

    document.save(path)


def build_pdf(path: Path, title: str, pages: List[ExportPage]) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        title=title,
    )
    styles = getSampleStyleSheet()
    story = [Paragraph(xml_escape(title), styles["Title"]), Spacer(1, 14)]

    for index, page in enumerate(pages, start=1):
        if len(pages) > 1:
            story.append(Paragraph(f"Page {index}", styles["Heading2"]))
            story.append(Spacer(1, 6))

        for chunk in split_chunks(page.text):
            # Paragraph markup treats text as mini-HTML: escape it, then turn
            # real line breaks back into <br/> so multi-line OCR text wraps.
            safe = xml_escape(chunk).replace("\n", "<br/>")
            story.append(Paragraph(safe, styles["BodyText"]))
            story.append(Spacer(1, 8))

        if index < len(pages):
            story.append(PageBreak())

    doc.build(story)


@app.post("/api/export")
def export_document(request: ExportRequest, user: str = Depends(current_user)):
    if not request.pages:
        raise HTTPException(status_code=400, detail="At least one page is required.")

    export_id = str(uuid.uuid4())
    safe_name = "".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in request.title).strip()
    safe_name = safe_name or "Job_Scan"

    if request.format == "pdf":
        filename = f"{safe_name}_{export_id[:8]}.pdf"
        path = EXPORT_DIR / filename
        try:
            build_pdf(path, request.title, request.pages)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc
    else:
        filename = f"{safe_name}_{export_id[:8]}.docx"
        path = EXPORT_DIR / filename
        try:
            build_word(path, request.title, request.pages)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Word export failed: {exc}") from exc

    return {
        "export_id": export_id,
        "filename": filename,
        "format": request.format,
        "download_url": f"/api/exports/{filename}",
    }


@app.get("/api/exports/{filename}")
def download_export(filename: str):
    safe_path = EXPORT_DIR / Path(filename).name
    if not safe_path.exists():
        raise HTTPException(status_code=404, detail="Export not found.")
    media_type = EXPORT_MEDIA_TYPES.get(safe_path.suffix.lower(), "application/octet-stream")
    return FileResponse(safe_path, media_type=media_type, filename=safe_path.name)

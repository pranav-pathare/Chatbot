"""Read every file in docs/, cut it into chunks, embed the chunks, save them to Chroma.

Run:   python ingest.py
Re-run whenever you add or change documents. It rebuilds the index from scratch
in a new collection and switches to it only when the build has finished.
"""
import email
import email.policy
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import zipfile
from pathlib import Path

import pandas as pd
from docx import Document
from pypdf import PdfReader

import config
from llm import embed
from store import activate_collection, new_collection


# ---------------------------------------------------------------- loaders
# Each loader yields (text, location) pairs. `location` is shown to the
# employee as part of the source tag, e.g. "Leave Policy.pdf, page 3".
# Libraries used by only one format are imported inside its loader, so a
# missing optional library only skips that format.

def _ocr_image(image) -> str:
    """OCR a PIL image. Needs `pip install pytesseract` and the Tesseract program."""
    import pytesseract

    return pytesseract.image_to_string(image)


def _ocr_available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def decode_bytes(data: bytes) -> str:
    """Decode text files saved by any common editor without silently losing characters.

    BOM first (UTF-8 / UTF-16 from Windows Notepad), then strict UTF-8, then
    Windows-1252 (old Windows default), which can decode any byte.
    """
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    sample = data[:4096]
    if sample and sample.count(b"\x00") > len(sample) // 4:  # UTF-16 without a BOM
        return data.decode("utf-16-le" if sample[1:2] == b"\x00" else "utf-16-be", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def read_text(path: Path) -> str:
    return decode_bytes(path.read_bytes())


def load_pdf(path: Path):
    reader = PdfReader(str(path))
    ocr = None  # decided on the first page without text
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if not text.strip():
            if ocr is None:
                ocr = _ocr_available()
            if ocr:  # scanned page: OCR its embedded images
                text = "\n".join(_ocr_image(img.image) for img in page.images)
        yield text, f"page {number}"


def _docx_lines(element, out: list):
    """Walk Word XML in document order. Paragraph text includes runs inside tracked
    insertions, hyperlinks and text boxes; deleted text (w:delText) is left out."""
    from docx.oxml.ns import qn

    for child in element.iterchildren():
        if child.tag == qn("w:p"):
            text = "".join(t.text or "" for t in child.iter(qn("w:t")))
            if text.strip():
                out.append(text)
        elif child.tag == qn("w:tbl"):
            for row in child.iterchildren(qn("w:tr")):
                cells = []
                for cell in row.iterchildren(qn("w:tc")):
                    inner = []
                    _docx_lines(cell, inner)  # nested tables end up inside the cell text
                    cells.append(" ".join(inner).strip())
                line = " | ".join(c for c in cells if c)
                if line:
                    out.append(line)
        elif child.tag in (qn("w:sdt"), qn("w:sdtContent"), qn("w:customXml"), qn("w:ins")):
            _docx_lines(child, out)  # content controls and block-level wrappers


def load_docx(path: Path):
    doc = Document(str(path))
    parts = []
    _docx_lines(doc.element.body, parts)
    yield "\n".join(parts), ""


def load_pptx(path: Path):
    from pptx import Presentation

    def shape_text(shapes, parts):
        for shape in shapes:
            if hasattr(shape, "shapes"):  # group shape: look inside
                shape_text(shape.shapes, parts)
                continue
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
            if getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))

    for number, slide in enumerate(Presentation(str(path)).slides, start=1):
        parts = []
        shape_text(slide.shapes, parts)
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame  # None if the notes page has no body
            if notes is not None:
                parts.append(notes.text)
        yield "\n".join(p for p in parts if p.strip()), f"slide {number}"


def _frame_to_text(df: pd.DataFrame) -> str:
    """One line per row, written as 'Column: value | Column: value'."""
    df = df.dropna(how="all").fillna("")
    lines = []
    for _, row in df.iterrows():
        pairs = [f"{col}: {str(val).strip()}" for col, val in row.items() if str(val).strip()]
        if pairs:
            lines.append(" | ".join(pairs))
    return "\n".join(lines)


def load_excel(path: Path):
    # .ods (OpenDocument spreadsheet) is read by pandas through the odfpy library.
    engine = "odf" if path.suffix.lower() == ".ods" else None
    for sheet_name, df in pd.read_excel(path, sheet_name=None, dtype=str, engine=engine).items():
        yield _frame_to_text(df), f"sheet {sheet_name}"


def load_csv(path: Path):
    sep = "\t" if path.suffix.lower() == ".tsv" else ","
    yield _frame_to_text(pd.read_csv(path, dtype=str, sep=sep)), ""


def load_text(path: Path):
    yield read_text(path), ""


def _html_to_text(html) -> str:
    """`html` may be bytes, so BeautifulSoup can honour the page's own charset."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    for row in soup.find_all("tr"):  # keep table rows on one line, like Word tables
        row.replace_with(" | ".join(c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])) + "\n")
    return soup.get_text("\n", strip=True)


def load_html(path: Path):
    yield _html_to_text(path.read_bytes()), ""


def load_xml(path: Path):
    from defusedxml import ElementTree  # safe against entity-expansion ("billion laughs") files

    root = ElementTree.parse(str(path)).getroot()
    yield "\n".join(t.strip() for t in root.itertext() if t.strip()), ""


def load_json(path: Path):
    """Flatten to 'key.path: value' lines so each fact keeps its label."""
    lines = []

    def walk(value, prefix):
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, f"{prefix}.{k}" if prefix else str(k))
        elif isinstance(value, list):
            for i, v in enumerate(value):
                walk(v, f"{prefix}[{i}]")
        elif value is not None and str(value).strip():
            lines.append(f"{prefix}: {value}" if prefix else str(value))

    walk(json.loads(read_text(path)), "")
    yield "\n".join(lines), ""


def load_rtf(path: Path):
    from striprtf.striprtf import rtf_to_text

    yield rtf_to_text(read_text(path)), ""


def load_odf_text(path: Path):
    """OpenDocument text and presentations (.odt, .odp)."""
    from odf import teletype
    from odf.namespaces import TEXTNS
    from odf.opendocument import load

    blocks = {(TEXTNS, "p"), (TEXTNS, "h")}
    parts = []

    def walk(node):  # document order, so headings stay with their paragraphs
        for child in node.childNodes:
            if getattr(child, "qname", None) in blocks:
                parts.append(teletype.extractText(child))
            elif child.nodeType == child.ELEMENT_NODE:
                walk(child)

    walk(load(str(path)).body)
    yield "\n".join(p for p in parts if p.strip()), ""


EPUB_MAX_BYTES = 50 * 1024 * 1024  # stop zip bombs: total uncompressed size we will read


def load_epub(path: Path):
    with zipfile.ZipFile(path) as book:
        pages = sorted(n for n in book.namelist() if n.lower().endswith((".xhtml", ".html", ".htm")))
        if sum(book.getinfo(n).file_size for n in pages) > EPUB_MAX_BYTES:
            raise ValueError("e-book is too large once uncompressed")
        for number, name in enumerate(pages, start=1):
            yield _html_to_text(book.read(name)), f"section {number}"


def _attachments(items):
    """Read e-mail attachments with the normal loaders. `items` yields (file name, bytes).

    Only the extension of the sender-supplied name is used (the file is saved under a
    fixed name in a temp folder), and attached e-mails are not opened, to avoid loops.
    """
    for name, data in items:
        suffix = Path(name or "").suffix.lower()
        if suffix not in LOADERS or suffix in (".eml", ".msg") or not data:
            if name:
                print(f"    - attachment {name}: not indexed (unsupported type)")
            continue
        if len(data) > config.MAX_FILE_MB * 1024 * 1024:
            print(f"    - attachment {name}: not indexed (larger than {config.MAX_FILE_MB} MB)")
            continue
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / f"attachment{suffix}"
            file.write_bytes(data)
            try:
                for text, location in LOADERS[suffix](file):
                    yield text, f"attachment {Path(name).name}" + (f", {location}" if location else "")
            except Exception as error:
                print(f"    - attachment {name}: not indexed ({error})")


def load_eml(path: Path):
    msg = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
    body = msg.get_body(preferencelist=("plain", "html"))
    content = body.get_content() if body else ""
    if body is not None and body.get_content_type() == "text/html":
        content = _html_to_text(content)
    header = "\n".join(f"{h}: {msg[h]}" for h in ("Subject", "From", "Date") if msg[h])
    yield f"{header}\n{content}", ""
    yield from _attachments((a.get_filename(), a.get_payload(decode=True)) for a in msg.iter_attachments())


def load_msg(path: Path):
    import extract_msg

    with extract_msg.openMsg(str(path)) as msg:
        header = "\n".join(f"{k}: {v}" for k, v in (("Subject", msg.subject), ("From", msg.sender), ("Date", msg.date)) if v)
        yield f"{header}\n{msg.body or ''}", ""
        files = [(a.longFilename or a.shortFilename, a.data) for a in msg.attachments if isinstance(a.data, bytes)]
        yield from _attachments(files)


def load_image(path: Path):
    if not _ocr_available():
        raise RuntimeError("images need OCR: pip install pytesseract and install Tesseract")
    from PIL import Image, ImageSequence

    with Image.open(path) as image:
        frames = getattr(image, "n_frames", 1)
        for number, frame in enumerate(ImageSequence.Iterator(image), start=1):  # multi-page TIFF scans
            yield _ocr_image(frame), f"page {number}" if frames > 1 else ""


def load_legacy_office(path: Path):
    """Old binary Office files (.doc, .ppt): convert with LibreOffice, then read the new file."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("install LibreOffice to read old .doc/.ppt files, or save them as .docx/.pptx")
    target = {".doc": "docx", ".ppt": "pptx"}[path.suffix.lower()]
    with tempfile.TemporaryDirectory() as out:
        # Own process group, so a timeout kills LibreOffice's helper processes too.
        proc = subprocess.Popen(
            [soffice, "--headless", "--convert-to", target, "--outdir", out, str(path.resolve())],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            if proc.wait(timeout=120) != 0:
                raise RuntimeError("LibreOffice could not convert the file")
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise RuntimeError("LibreOffice took longer than 120 seconds")
        converted = Path(out) / f"{path.stem}.{target}"
        yield from LOADERS[f".{target}"](converted)


LOADERS = {
    ".pdf": load_pdf,
    ".docx": load_docx,
    ".doc": load_legacy_office,
    ".pptx": load_pptx,
    ".ppt": load_legacy_office,
    ".xlsx": load_excel,
    ".xlsm": load_excel,
    ".xls": load_excel,
    ".ods": load_excel,
    ".odt": load_odf_text,
    ".odp": load_odf_text,
    ".csv": load_csv,
    ".tsv": load_csv,
    ".txt": load_text,
    ".md": load_text,
    ".markdown": load_text,
    ".rst": load_text,
    ".log": load_text,
    ".yaml": load_text,
    ".yml": load_text,
    ".rtf": load_rtf,
    ".html": load_html,
    ".htm": load_html,
    ".xml": load_xml,
    ".json": load_json,
    ".epub": load_epub,
    ".eml": load_eml,
    ".msg": load_msg,
    ".png": load_image,
    ".jpg": load_image,
    ".jpeg": load_image,
    ".tif": load_image,
    ".tiff": load_image,
    ".bmp": load_image,
}


# --------------------------------------------------------------- chunking
def chunk_text(text: str, size: int = config.CHUNK_SIZE, overlap: int = config.CHUNK_OVERLAP):
    """Pack whole lines into chunks of roughly `size` characters.

    Lines are never cut mid-way unless one line alone is longer than `size`.
    Each new chunk starts with the tail of the previous one (`overlap`) so a
    sentence on a boundary is not lost.
    """
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    pieces = []
    for line in filter(None, lines):
        while len(line) > size:  # a very long line: split at a sentence or space
            cut = line.rfind(". ", 0, size)
            if cut == -1:
                cut = line.rfind(" ", 0, size)
            if cut == -1:
                cut = size - 1
            pieces.append(line[: cut + 1].strip())
            line = line[cut + 1 :].strip()
        if line:
            pieces.append(line)

    chunks, current = [], ""
    for piece in pieces:
        if current and len(current) + len(piece) + 1 > size:
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            tail = tail[tail.find(" ") + 1 :] if " " in tail else ""  # start on a word
            current = f"{tail} {piece}".strip()
        else:
            current = f"{current}\n{piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks


# ------------------------------------------------------------------- main
def find_files():
    root = config.DOCS_DIR.resolve()
    files = []
    for p in config.DOCS_DIR.rglob("*"):
        if (
            p.is_file()
            and not p.is_symlink()  # a link could point at files outside docs/
            and p.resolve().is_relative_to(root)
            and p.suffix.lower() in LOADERS
            and not p.name.startswith(("~$", "."))  # skip Office temp files and hidden files
        ):
            files.append(p)
    return sorted(files)


def collect_records(files):
    records = []
    max_bytes = config.MAX_FILE_MB * 1024 * 1024
    for path in files:
        name = str(path.relative_to(config.DOCS_DIR))
        if path.stat().st_size > max_bytes:
            print(f"  ! Skipped {name}: larger than {config.MAX_FILE_MB} MB (raise MAX_FILE_MB to include it)")
            continue
        found = []  # only added to records once the whole file has loaded
        try:
            for text, location in LOADERS[path.suffix.lower()](path):
                for chunk in chunk_text(text):
                    found.append({"text": chunk, "source": name, "location": location})
        except Exception as error:
            print(f"  ! Skipped {name}: {error}")
            continue
        if not found:
            print(f"  ! {name}: no text found (a scanned PDF or image needs OCR: see README)")
        else:
            records.extend(found)
            print(f"  + {name}: {len(found)} chunks")
    return records


def main():
    config.DOCS_DIR.mkdir(exist_ok=True)
    print(f"Reading documents from {config.DOCS_DIR}")
    files = find_files()
    records = collect_records(files)
    if files and not records:
        # Every file failed: keep serving the old index rather than wiping it.
        raise SystemExit("No file could be read, so the existing index was kept. Fix the files above and run again.")
    collection = new_collection()

    if records:
        print(f"Embedding {len(records)} chunks...")
        # The file name goes into the embedded text so a question like
        # "what does the asset policy say" can match on the title too.
        titled = [f"{Path(r['source']).stem}\n{r['text']}" for r in records]
        vectors = embed(titled)
        step = 500
        for i in range(0, len(records), step):
            part = records[i : i + step]
            collection.add(
                ids=[f"chunk-{i + j}" for j in range(len(part))],
                documents=[r["text"] for r in part],
                embeddings=vectors[i : i + step],
                metadatas=[{"source": r["source"], "location": r["location"]} for r in part],
            )

    # Switch only after the new index is complete; the old one keeps serving until now.
    activate_collection(collection)
    if records:
        print(f"Done. {collection.count()} chunks indexed.")
    else:
        print("docs/ is empty, so the index was cleared. Add documents and run again.")


if __name__ == "__main__":
    main()

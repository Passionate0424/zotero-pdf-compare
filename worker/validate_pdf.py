"""Validate every PDF page. No document text, metadata or exception is logged."""
import json
import sys
import fitz

try:
    with fitz.open(sys.argv[1]) as doc:
        if not doc.is_pdf or doc.is_encrypted or doc.page_count < 1:
            raise ValueError("invalid")
        characters = 0
        sizes = []
        for page in doc:
            if page.rect.width <= 0 or page.rect.height <= 0:
                raise ValueError("dimensions")
            characters += len(page.get_text())
            # Parse and rasterize every page to detect broken content/resources.
            pix = page.get_pixmap(matrix=fitz.Matrix(0.12, 0.12), alpha=False)
            if pix.width < 1 or pix.height < 1:
                raise ValueError("render")
            sizes.append([round(page.rect.width, 2), round(page.rect.height, 2)])
        print(json.dumps({"valid": True, "pages": doc.page_count,
                          "checkedPages": len(sizes), "sizes": sizes,
                          "hasTextLayer": characters > 0, "textCharacters": characters}))
except Exception:
    print(json.dumps({"valid": False}))
    sys.exit(1)

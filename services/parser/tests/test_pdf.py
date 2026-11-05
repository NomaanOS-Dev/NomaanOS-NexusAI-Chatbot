"""Unit tests for PdfParser."""

import io
import pytest
from pypdf import PdfWriter
from nexus_parser.parsers.pdf import PdfParser
from nexus_parser.models import ExtractionStatus, DocumentFormat


@pytest.fixture
def synthetic_pdf_bytes():
    writer = PdfWriter()
    # Page 1
    page1 = writer.add_blank_page(width=612, height=792)
    # Page 2
    page2 = writer.add_blank_page(width=612, height=792)
    
    # We can write out minimal valid PDF
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_pdf_blank_pages_warning(synthetic_pdf_bytes):
    parser = PdfParser()
    assert parser.can_parse("doc.pdf") is True

    doc = parser.parse(synthetic_pdf_bytes, "blank_document.pdf")
    assert doc.format == DocumentFormat.PDF.value
    # Since pages were blank, status should be completed_with_warnings or warning recorded
    assert len(doc.warnings) >= 1
    assert any("OCR" in w.message for w in doc.warnings)
    assert doc.metadata.page_count == 2


def test_pdf_invalid_signature():
    parser = PdfParser()
    fake_pdf = b"This is not a real PDF file despite the extension"
    with pytest.raises(ValueError, match="Invalid PDF: Missing '%PDF-'"):
        parser.parse(fake_pdf, "fake.pdf")


def test_pdf_corrupt_data():
    parser = PdfParser()
    corrupt_pdf = b"%PDF-1.4\n%Corrupt binary gibberish that cannot be parsed as a PDF xref table"
    with pytest.raises(ValueError, match="Malformed or corrupt PDF"):
        parser.parse(corrupt_pdf, "corrupted.pdf")


import argparse
import html
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


XML_NS = {
    "container": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def read_zip_text(epub: zipfile.ZipFile, name: str) -> str:
    data = epub.read(name)
    for encoding in ("utf-8", "utf-16", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def strip_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?</\1>", "\n", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|h[1-6]|li|section|article)>", "\n", raw)
    raw = re.sub(r"(?is)<[^>]+>", "", raw)
    text = html.unescape(raw)
    text = text.replace("\u3000", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


def extract_title(raw: str, fallback: str) -> str:
    for pattern in [
        r"(?is)<h1[^>]*>(.*?)</h1>",
        r"(?is)<h2[^>]*>(.*?)</h2>",
        r"(?is)<title[^>]*>(.*?)</title>",
    ]:
        match = re.search(pattern, raw)
        if match:
            title = strip_html(match.group(1)).splitlines()[0:1]
            if title and title[0].strip():
                return title[0].strip()[:120]
    return fallback


def first_text(root: ET.Element, path: str) -> str:
    node = root.find(path, XML_NS)
    return (node.text or "").strip() if node is not None else ""


def parse_epub(path: str) -> dict:
    with zipfile.ZipFile(path) as epub:
        container_xml = read_zip_text(epub, "META-INF/container.xml")
        container_root = ET.fromstring(container_xml)
        rootfile = container_root.find(".//container:rootfile", XML_NS)
        if rootfile is None:
            raise RuntimeError("EPUB container has no rootfile")

        opf_path = rootfile.attrib["full-path"]
        opf_dir = posixpath.dirname(opf_path)
        opf_xml = read_zip_text(epub, opf_path)
        opf_root = ET.fromstring(opf_xml)

        title = first_text(opf_root, ".//dc:title")
        creator = first_text(opf_root, ".//dc:creator")
        manifest = {}
        for item in opf_root.findall(".//opf:manifest/opf:item", XML_NS):
            item_id = item.attrib.get("id")
            href = item.attrib.get("href")
            media_type = item.attrib.get("media-type", "")
            if item_id and href:
                manifest[item_id] = {
                    "href": posixpath.normpath(posixpath.join(opf_dir, href)),
                    "mediaType": media_type,
                }

        sections = []
        for itemref in opf_root.findall(".//opf:spine/opf:itemref", XML_NS):
            idref = itemref.attrib.get("idref")
            item = manifest.get(idref or "")
            if not item:
                continue
            if "html" not in item["mediaType"] and not item["href"].lower().endswith((".html", ".xhtml", ".htm")):
                continue
            href = item["href"]
            try:
                raw = read_zip_text(epub, href)
            except KeyError:
                continue
            text = strip_html(raw)
            if len(text) < 40:
                continue
            sections.append({
                "href": href,
                "title": extract_title(raw, posixpath.basename(href)),
                "text": text,
            })

        return {
            "metadata": {
                "title": title,
                "creator": creator,
                "sectionCount": len(sections),
            },
            "sections": sections,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("epub")
    args = parser.parse_args()
    parsed = parse_epub(args.epub)
    json.dump(parsed, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
word_bridge.py — Microsoft Word COM Automation Bridge.

Mode operasi:
  - Mode 1 (Ghost): inject langsung ke cursor aktif, user lihat tulisan muncul
  - Mode 2 (Batch): tulis ke bookmark/page tertentu tanpa mengganggu cursor
  - Mode 3 (Read): baca konten dokumen untuk analisis AI

Contoh command via stdin:
  {"action": "write_at_cursor", "text": "Halo ini ghost ngetik...", "typing_speed": 0.01}
  {"action": "get_active_document", "include_text": true}
  {"action": "format_selection", "bold": true, "font_size": 14}
  {"action": "find_replace", "find": "typo", "replace": "perbaikan"}
  {"action": "fix_typos", "language": "id"}
  {"action": "fix_alignment", "alignment": "justify"}
  {"action": "search_web_and_write", "query": "pengertian prolog dalam novel"}
  {"action": "read_full_document"}
  {"action": "exit"}
"""

import time
import re
from desktop.office_base import OfficeBridge, is_windows


class WordBridge(OfficeBridge):
    APP_NAME = "Word.Application"

    # ── Koneksi spesifik Word ─────────────────────────────────────

    def connect(self):
        super().connect()
        # Matikan screen updating biar lebih cepat — tapi untuk ghost
        # experience, kita biarkan ON biar user lihat
        self.app.ScreenUpdating = True
        return True

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        handlers = {
            # ── Baca ──
            "get_active_document": self._get_active_document,
            "get_selection": self._get_selection,
            "read_full_document": self._read_full_document,
            "read_page": self._read_page,
            "get_document_info": self._get_document_info,

            # ── Tulis (Ghost mode) ──
            "write_at_cursor": self._write_at_cursor,
            "write_at_bookmark": self._write_at_bookmark,
            "write_at_page": self._write_at_page,
            "write_at_position": self._write_at_position,
            "replace_selection": self._replace_selection,

            # ── Edit / Format ──
            "format_selection": self._format_selection,
            "format_paragraph": self._format_paragraph,
            "format_document": self._format_document,
            "find_replace": self._find_replace,
            "find_replace_all": self._find_replace_all,
            "delete_selection": self._delete_selection,
            "delete_text": self._delete_text,
            "insert_table": self._insert_table,
            "insert_image": self._insert_image,
            "insert_page_break": self._insert_page_break,

            # ── Cerdas ──
            "fix_typos": self._fix_typos,
            "fix_alignment": self._fix_alignment,
            "fix_spacing": self._fix_spacing,
            "fix_fonts": self._fix_fonts,
            "apply_style": self._apply_style,

            # ── Web + Tulis ──
            "search_web_and_write": self._search_web_and_write,

            # ── Utility ──
            "scroll_to": self._scroll_to,
            "go_to_page": self._go_to_page,
            "select_all": self._select_all,
        }

        handler = handlers.get(action)
        if handler is None:
            raise ValueError(
                f"Action '{action}' tidak dikenal. "
                f"Yang tersedia: {', '.join(handlers.keys())}"
            )
        return handler(cmd)

    # ── Ensure document ───────────────────────────────────────────

    def _ensure_active_document(self):
        if self.app.Documents.Count == 0:
            raise RuntimeError(
                "Tidak ada dokumen Word yang terbuka. "
                "Buka dulu dokumennya!"
            )
        return self.app.ActiveDocument

    # ═══════════════════════════════════════════════════════════
    # 🔍 READ — Baca dokumen
    # ═══════════════════════════════════════════════════════════

    def _get_active_document(self, cmd):
        """Dapatkan info dokumen aktif."""
        doc = self._ensure_active_document()
        info = {
            "name": doc.Name,
            "path": doc.FullName,
            "pages": doc.ComputeStatistics(2),  # wdStatisticPages
            "words": doc.ComputeStatistics(0),  # wdStatisticWords
            "paragraphs": doc.Paragraphs.Count,
            "sections": doc.Sections.Count,
        }
        if cmd.get("include_text", False):
            info["text"] = doc.Content.Text[:10000]  # max 10k chars

        # Ambil selection info
        sel = self.app.Selection
        info["selection"] = {
            "text": sel.Text[:500] if sel.Text else "",
            "page": sel.Information(3),  # wdActiveEndPageNumber
            "paragraph": sel.Paragraphs.Count > 0,
        }
        return info

    def _get_selection(self, cmd):
        """Dapatkan teks yang sedang dipilih."""
        sel = self.app.Selection
        if not sel.Text or sel.Text.strip() == "":
            return {"text": "", "has_selection": False}
        return {
            "text": sel.Text.strip(),
            "has_selection": True,
            "length": len(sel.Text.strip()),
            "page": sel.Information(3),
        }

    def _read_full_document(self, cmd):
        """Baca seluruh konten dokumen."""
        doc = self._ensure_active_document()
        max_chars = cmd.get("max_chars", 20000)
        text = doc.Content.Text[:max_chars]
        return {
            "text": text,
            "total_chars": len(doc.Content.Text),
            "truncated": len(doc.Content.Text) > max_chars,
            "name": doc.Name,
        }

    def _read_page(self, cmd):
        """Baca konten halaman tertentu."""
        doc = self._ensure_active_document()
        page_num = cmd.get("page", 1)

        # Go to page
        self.app.Selection.GoTo(What=1, Which=1, Count=page_num)
        # Select to end of page
        self.app.Selection.Bookmarks("\Page").Select()

        return {
            "page": page_num,
            "text": self.app.Selection.Text.strip()[:5000],
        }

    def _get_document_info(self, cmd):
        """Dapatkan metadata dokumen."""
        doc = self._ensure_active_document()
        try:
            builtin = doc.BuiltInDocumentProperties
            info = {
                "title": str(builtin("Title").Value or ""),
                "author": str(builtin("Author").Value or ""),
                "subject": str(builtin("Subject").Value or ""),
                "last_modified": str(builtin("Last Save Time").Value or ""),
            }
        except Exception:
            info = {}
        info.update(self._get_active_document(cmd))
        return info

    # ═══════════════════════════════════════════════════════════
    # ✍️ WRITE — Ghost typing
    # ═══════════════════════════════════════════════════════════

    def _write_at_cursor(self, cmd):
        """Ghost typing — ngetik di posisi cursor seperti manusia."""
        text = cmd.get("text", "")
        if not text:
            raise ValueError("Parameter 'text' wajib diisi")

        # Pilihan kecepatan: detik per karakter
        speed = cmd.get("typing_speed", 0.0)

        # Ghost mode — karakter per karakter
        if speed > 0:
            for char in text:
                self.app.Selection.TypeText(char)
                time.sleep(speed)
        else:
            # Instant — langsung semua
            self.app.Selection.TypeText(text)

        # Enter di akhir kalau diminta
        if cmd.get("press_enter", False):
            self.app.Selection.TypeParagraph()

        typed_chars = len(text)
        return {
            "action": "write_at_cursor",
            "chars_typed": typed_chars,
            "typing_speed": speed,
            "ghost_mode": speed > 0,
        }

    def _write_at_bookmark(self, cmd):
        """Tulis ke bookmark tertentu."""
        doc = self._ensure_active_document()
        bookmark_name = cmd.get("bookmark", "")
        text = cmd.get("text", "")

        if not bookmark_name:
            raise ValueError("Parameter 'bookmark' wajib diisi")
        if not text:
            raise ValueError("Parameter 'text' wajib diisi")

        try:
            bookmark = doc.Bookmarks(bookmark_name)
            bookmark.Select()
            self.app.Selection.TypeText(text)
            return {"action": "write_at_bookmark", "bookmark": bookmark_name}
        except Exception as e:
            raise ValueError(f"Bookmark '{bookmark_name}' tidak ditemukan: {e}")

    def _write_at_page(self, cmd):
        """Tulis di halaman tertentu."""
        page_num = cmd.get("page", 1)
        text = cmd.get("text", "")
        position = cmd.get("position", "end")  # 'start' | 'end'

        # Go to page
        self.app.Selection.GoTo(What=1, Which=1, Count=page_num)

        if position == "end":
            # Scroll ke akhir halaman
            self.app.Selection.EndOf(Unit=6)  # wdStory
        elif position == "start":
            self.app.Selection.HomeKey(Unit=6)

        self.app.Selection.TypeText(text)
        return {"action": "write_at_page", "page": page_num, "position": position}

    def _write_at_position(self, cmd):
        """Tulis di posisi relatif tertentu (line, column)."""
        line = cmd.get("line", 1)
        column = cmd.get("column", 1)
        text = cmd.get("text", "")

        # Pindah ke posisi
        self.app.Selection.HomeKey(Unit=6)  # ke awal cerita
        for _ in range(line - 1):
            self.app.Selection.MoveDown(Unit=5, Count=1)  # wdLine
        for _ in range(column - 1):
            self.app.Selection.MoveRight(Unit=5, Count=1)

        self.app.Selection.TypeText(text)
        return {"action": "write_at_position", "line": line, "column": column}

    def _replace_selection(self, cmd):
        """Replace teks yang sedang dipilih."""
        sel = self.app.Selection
        if not sel.Text or sel.Text.strip() == "":
            raise ValueError("Tidak ada teks yang dipilih")

        old_text = sel.Text
        new_text = cmd.get("text", "")
        self.app.Selection.TypeText(new_text)

        return {
            "action": "replace_selection",
            "replaced": old_text[:200],
            "with": new_text[:200],
        }

    # ═══════════════════════════════════════════════════════════
    # 🎨 FORMAT — Perapihan
    # ═══════════════════════════════════════════════════════════

    def _format_selection(self, cmd):
        """Format teks yang dipilih."""
        sel = self.app.Selection
        font = sel.Font
        para = sel.ParagraphFormat

        changes = []

        if "bold" in cmd:
            font.Bold = int(cmd["bold"])
            changes.append(f"bold={cmd['bold']}")
        if "italic" in cmd:
            font.Italic = int(cmd["italic"])
            changes.append(f"italic={cmd['italic']}")
        if "underline" in cmd:
            font.Underline = 1 if cmd["underline"] else 0
            changes.append(f"underline={cmd['underline']}")
        if "font_size" in cmd:
            font.Size = cmd["font_size"]
            changes.append(f"font_size={cmd['font_size']}")
        if "font_name" in cmd:
            font.Name = cmd["font_name"]
            changes.append(f"font_name={cmd['font_name']}")
        if "color" in cmd:
            from win32com.client import constants
            color_map = {
                "red": 255, "blue": 16711680, "green": 65280,
                "black": 0, "white": 16777215, "gray": 8421504,
            }
            color = color_map.get(cmd["color"].lower(), int(cmd["color"]))
            font.Color = color
            changes.append(f"color={cmd['color']}")
        if "highlight" in cmd:
            color_map = {"yellow": 7, "green": 11, "red": 6, "blue": 12, "none": 0}
            font.HighlightColorIndex = color_map.get(cmd["highlight"].lower(), 0)
            changes.append(f"highlight={cmd['highlight']}")

        return {"action": "format_selection", "changes": changes}

    def _format_paragraph(self, cmd):
        """Format paragraf (alignment, spacing, dll)."""
        para = self.app.Selection.ParagraphFormat
        changes = []

        alignment_map = {
            "left": 0, "center": 1, "right": 2, "justify": 3,
        }
        if "alignment" in cmd:
            align = alignment_map.get(cmd["alignment"].lower(), 0)
            if align is not None:
                para.Alignment = align
                changes.append(f"alignment={cmd['alignment']}")

        if "line_spacing" in cmd:
            para.LineSpacing = cmd["line_spacing"]
            changes.append(f"line_spacing={cmd['line_spacing']}")

        if "space_before" in cmd:
            para.SpaceBefore = cmd["space_before"]
            changes.append(f"space_before={cmd['space_before']}")

        if "space_after" in cmd:
            para.SpaceAfter = cmd["space_after"]
            changes.append(f"space_after={cmd['space_after']}")

        if "first_line_indent" in cmd:
            para.FirstLineIndent = cmd["first_line_indent"]
            changes.append(f"first_line_indent={cmd['first_line_indent']}")

        return {"action": "format_paragraph", "changes": changes}

    def _format_document(self, cmd):
        """Format seluruh dokumen (default style)."""
        doc = self._ensure_active_document()
        content = doc.Content

        changes = []

        # Set default font
        if "default_font" in cmd:
            font = cmd["default_font"]
            content.Font.Name = font.get("name", content.Font.Name)
            content.Font.Size = font.get("size", content.Font.Size)
            changes.append(f"default_font={font}")

        # Set default paragraph
        if "default_paragraph" in cmd:
            para = cmd["default_paragraph"]
            for p in doc.Paragraphs:
                if "alignment" in para:
                    p.Alignment = {"left": 0, "center": 1, "right": 2, "justify": 3}.get(
                        para["alignment"].lower(), 0
                    )
                if "line_spacing" in para:
                    p.LineSpacing = para["line_spacing"]
            changes.append(f"default_paragraph={para}")

        # Set margins
        if "margins" in cmd:
            m = cmd["margins"]
            for section in doc.Sections:
                section.PageSetup.TopMargin = m.get("top", section.PageSetup.TopMargin)
                section.PageSetup.BottomMargin = m.get("bottom", section.PageSetup.BottomMargin)
                section.PageSetup.LeftMargin = m.get("left", section.PageSetup.LeftMargin)
                section.PageSetup.RightMargin = m.get("right", section.PageSetup.RightMargin)
            changes.append(f"margins={m}")

        return {"action": "format_document", "changes": changes}

    # ═══════════════════════════════════════════════════════════
    # 🔍 FIND & REPLACE
    # ═══════════════════════════════════════════════════════════

    def _find_replace(self, cmd):
        """Find dan replace teks (sekali)."""
        find_text = cmd.get("find", "")
        replace_text = cmd.get("replace", "")

        if not find_text:
            raise ValueError("Parameter 'find' wajib diisi")

        find_obj = self.app.Selection.Find
        find_obj.Text = find_text
        find_obj.Replacement.Text = replace_text
        find_obj.Forward = True
        find_obj.Wrap = 1  # wdFindContinue

        found = find_obj.Execute(Replace=1)  # wdReplaceOne

        return {
            "action": "find_replace",
            "find": find_text,
            "replace": replace_text,
            "found": bool(found),
        }

    def _find_replace_all(self, cmd):
        """Find dan replace semua."""
        find_text = cmd.get("find", "")
        replace_text = cmd.get("replace", "")

        if not find_text:
            raise ValueError("Parameter 'find' wajib diisi")

        find_obj = self.app.Selection.Find
        find_obj.Text = find_text
        find_obj.Replacement.Text = replace_text
        find_obj.Forward = True
        find_obj.Wrap = 1
        find_obj.Format = False
        find_obj.MatchCase = cmd.get("match_case", False)
        find_obj.MatchWholeWord = cmd.get("match_word", False)

        replaced = find_obj.Execute(Replace=2)  # wdReplaceAll

        return {
            "action": "find_replace_all",
            "find": find_text,
            "replace": replace_text,
            "replaced_all": bool(replaced),
        }

    # ═══════════════════════════════════════════════════════════
    # 🧹 SMART — Perbaikan cerdas
    # ═══════════════════════════════════════════════════════════

    def _fix_typos(self, cmd):
        """Scan dan perbaiki typo menggunakan spelling checker Word."""
        doc = self._ensure_active_document()
        language = cmd.get("language", "id")

        # Word built-in spell checker
        proof = doc.Content
        errors_found = proof.SpellingErrors.Count
        grammar_errors = proof.GrammaticalErrors.Count

        corrected = 0
        corrections = []

        # Iterasi per kata — sederhana
        for word in proof.Words:
            if word.SpellingErrors.Count > 0:
                # Ada saran?
                suggestions = word.GetSpellingSuggestions()
                if suggestions.Count > 0:
                    correct_word = suggestions(1).Name
                    corrections.append({
                        "original": word.Text.strip(),
                        "suggestion": correct_word,
                    })
                    word.Text = correct_word
                    corrected += 1

        return {
            "action": "fix_typos",
            "spelling_errors": errors_found,
            "grammar_errors": grammar_errors,
            "corrected": corrected,
            "corrections": corrections[:20],  # max 20 detail
            "language": language,
        }

    def _fix_alignment(self, cmd):
        """Rapihkan alignment seluruh dokumen."""
        doc = self._ensure_active_document()
        alignment = cmd.get("alignment", "justify")
        align_map = {"left": 0, "center": 1, "right": 2, "justify": 3}
        align_val = align_map.get(alignment.lower(), 3)

        para_count = doc.Paragraphs.Count
        changed = 0
        for p in doc.Paragraphs:
            if p.Alignment != align_val:
                p.Alignment = align_val
                changed += 1

        return {
            "action": "fix_alignment",
            "alignment": alignment,
            "total_paragraphs": para_count,
            "changed": changed,
        }

    def _fix_spacing(self, cmd):
        """Rapihkan spacing antar paragraf."""
        doc = self._ensure_active_document()
        mode = cmd.get("mode", "normalize")  # 'normalize' | 'compact' | 'expand'
        changed = 0

        for p in doc.Paragraphs:
            old_before = p.SpaceBefore
            old_after = p.SpaceAfter

            if mode == "normalize":
                p.SpaceBefore = 6
                p.SpaceAfter = 6
            elif mode == "compact":
                p.SpaceBefore = 0
                p.SpaceAfter = 3
            elif mode == "expand":
                p.SpaceBefore = 12
                p.SpaceAfter = 12

            if p.SpaceBefore != old_before or p.SpaceAfter != old_after:
                changed += 1

        return {
            "action": "fix_spacing",
            "mode": mode,
            "paragraphs_changed": changed,
        }

    def _fix_fonts(self, cmd):
        """Standardisasi font di seluruh dokumen."""
        doc = self._ensure_active_document()
        font_name = cmd.get("font_name", "Calibri")
        font_size = cmd.get("font_size", 11)
        changed = 0

        for p in doc.Paragraphs:
            if p.Range.Font.Name != font_name:
                p.Range.Font.Name = font_name
                changed += 1
            if p.Range.Font.Size != font_size:
                p.Range.Font.Size = font_size
                changed += 1

        return {
            "action": "fix_fonts",
            "font_name": font_name,
            "font_size": font_size,
            "changes": changed,
        }

    def _apply_style(self, cmd):
        """Apply Word style ke selection atau seluruh dokumen."""
        style_name = cmd.get("style", "Normal")
        scope = cmd.get("scope", "selection")  # 'selection' | 'document'

        if scope == "selection":
            self.app.Selection.set_Style(style_name)
        else:
            doc = self._ensure_active_document()
            doc.Content.set_Style(style_name)

        return {
            "action": "apply_style",
            "style": style_name,
            "scope": scope,
        }

    # ═══════════════════════════════════════════════════════════
    # 🌐 WEB + WRITE — Search and inject
    # ═══════════════════════════════════════════════════════════

    def _search_web_and_write(self, cmd):
        """Cari dari web lalu tulis langsung ke dokumen.

        CATATAN: Fungsi ini MEMANGGIL AGENT LAGI (recursive call ke stdout).
        Karena bridge ini tidak punya akses web, kita kirim sinyal ke
        agent framework untuk search, lalu agent kirim balik hasilnya.

        Alternatif: bridge kirim response khusus, agent framework
        yang handle pencariannya.
        """
        # Bridge kirim sinyal: "saya perlu agent search dulu"
        # Ini ditangani oleh desktop.js di Node.js side
        self.send_response({
            "success": True,
            "action": "search_web_and_write",
            "needs_web_search": True,
            "query": cmd.get("query", ""),
            "message": "Web search request sent to agent. Agent will search and send back the text to write.",
        })

        # Setelah agent search dan kirim "write_result", kita terima
        # command berikutnya dari stdin dengan hasil search
        # Ini di-handle di loop utama
        return {"status": "awaiting_web_search"}

    # ═══════════════════════════════════════════════════════════
    # 📋 INSERT — Table, image, break
    # ═══════════════════════════════════════════════════════════

    def _insert_table(self, cmd):
        """Insert tabel di posisi cursor."""
        doc = self._ensure_active_document()
        rows = cmd.get("rows", 3)
        cols = cmd.get("cols", 3)
        data = cmd.get("data", None)  # list of lists

        selection = self.app.Selection
        table = doc.Tables.Add(
            selection.Range, rows, cols
        )

        # Isi data kalau ada
        if data:
            for i, row_data in enumerate(data):
                for j, cell_value in enumerate(row_data):
                    if i < rows and j < cols:
                        table.Cell(i + 1, j + 1).Range.Text = str(cell_value)

        # Format
        table.Borders.Enable = 1

        return {
            "action": "insert_table",
            "rows": rows,
            "cols": cols,
            "has_data": data is not None,
        }

    def _insert_image(self, cmd):
        """Insert gambar dari file."""
        doc = self._ensure_active_document()
        image_path = cmd.get("image_path", "")
        width = cmd.get("width", None)
        height = cmd.get("height", None)

        if not image_path:
            raise ValueError("Parameter 'image_path' wajib diisi")

        if not os.path.exists(image_path):
            raise FileNotFoundError(f"File gambar tidak ditemukan: {image_path}")

        inline_shape = doc.InlineShapes.AddPicture(image_path)

        if width:
            inline_shape.Width = width
        if height:
            inline_shape.Height = height

        return {
            "action": "insert_image",
            "image_path": image_path,
            "width": inline_shape.Width,
            "height": inline_shape.Height,
        }

    def _insert_page_break(self, cmd):
        """Insert page break."""
        self.app.Selection.InsertBreak(7)  # wdPageBreak
        return {"action": "insert_page_break"}

    # ═══════════════════════════════════════════════════════════
    # 🧭 NAVIGATION
    # ═══════════════════════════════════════════════════════════

    def _scroll_to(self, cmd):
        """Scroll ke posisi tertentu."""
        position = cmd.get("position", "start")  # 'start' | 'end' | number
        if position == "start":
            self.app.Selection.HomeKey(Unit=6)
        elif position == "end":
            self.app.Selection.EndKey(Unit=6)
        else:
            try:
                page = int(position)
                self.app.Selection.GoTo(What=1, Which=1, Count=page)
            except ValueError:
                raise ValueError(f"Position tidak dikenal: {position}")

        return {"action": "scroll_to", "position": position}

    def _go_to_page(self, cmd):
        """Pindah ke halaman tertentu."""
        page = cmd.get("page", 1)
        self.app.Selection.GoTo(What=1, Which=1, Count=page)
        return {"action": "go_to_page", "page": page}

    def _select_all(self, cmd):
        """Select seluruh dokumen."""
        self.app.Selection.WholeStory()
        return {"action": "select_all", "selected": True}

    # ═══════════════════════════════════════════════════════════
    # 🗑️ DELETE
    # ═══════════════════════════════════════════════════════════

    def _delete_selection(self, cmd):
        """Hapus teks yang dipilih."""
        sel = self.app.Selection
        if sel.Text and sel.Text.strip():
            deleted_text = sel.Text[:200]
            sel.Delete()
            return {"action": "delete_selection", "deleted": deleted_text}
        return {"action": "delete_selection", "deleted": "", "note": "nothing selected"}

    def _delete_text(self, cmd):
        """Hapus teks spesifik dari dokumen."""
        find_text = cmd.get("text", "")
        if not find_text:
            raise ValueError("Parameter 'text' wajib diisi")

        find_obj = self.app.Selection.Find
        find_obj.Text = find_text
        find_obj.Forward = True
        find_obj.Wrap = 1

        found = find_obj.Execute()
        if found:
            self.app.Selection.Delete()
            return {"action": "delete_text", "deleted": find_text, "found": True}
        return {"action": "delete_text", "deleted": "", "found": False}


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN — Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = WordBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()

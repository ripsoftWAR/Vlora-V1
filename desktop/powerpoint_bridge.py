"""
powerpoint_bridge.py — Microsoft PowerPoint COM Automation Bridge.

Ghost mode untuk presentasi:
  - Tulis teks ke slide yang sedang aktif
  - Format slide elements
  - Add/remove slides
  - Baca konten presentasi

Contoh command via stdin:
  {"action": "get_active_presentation"}
  {"action": "get_current_slide"}
  {"action": "write_to_slide", "text": "Judul Baru", "placeholder_index": 1}
  {"action": "add_textbox", "text": "Konten baru", "left": 50, "top": 100}
  {"action": "add_slide", "layout": "blank"}
  {"action": "format_slide", "background_color": 16711680}
  {"action": "exit"}
"""

import traceback
from desktop.office_base import OfficeBridge


class PowerPointBridge(OfficeBridge):
    APP_NAME = "PowerPoint.Application"

    def connect(self):
        super().connect()
        self.app.Visible = True
        return True

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        handlers = {
            # ── Baca ──
            "get_active_presentation": self._get_active_presentation,
            "get_current_slide": self._get_current_slide,
            "get_all_slides": self._get_all_slides,
            "get_slide_content": self._get_slide_content,

            # ── Tulis ──
            "write_to_slide": self._write_to_slide,
            "add_textbox": self._add_textbox,
            "add_text_to_slide": self._add_text_to_slide,

            # ── Slide Management ──
            "add_slide": self._add_slide,
            "delete_slide": self._delete_slide,
            "duplicate_slide": self._duplicate_slide,
            "move_slide": self._move_slide,

            # ── Format ──
            "format_slide": self._format_slide,
            "format_text": self._format_text,
            "change_layout": self._change_layout,
            "apply_theme": self._apply_theme,
            "set_transition": self._set_transition,

            # ── Gambar ──
            "add_image": self._add_image,
            "add_shape": self._add_shape,

            # ── Cerdas ──
            "fix_font_size": self._fix_font_size,
            "fix_alignment": self._fix_alignment,
            "fix_bullet_spacing": self._fix_bullet_spacing,
        }

        handler = handlers.get(action)
        if handler is None:
            raise ValueError(
                f"Action '{action}' tidak dikenal. "
                f"Yang tersedia: {', '.join(handlers.keys())}"
            )
        return handler(cmd)

    # ── Ensure presentation ───────────────────────────────────────

    def _ensure_active_presentation(self):
        if self.app.Presentations.Count == 0:
            raise RuntimeError(
                "Tidak ada presentasi PowerPoint yang terbuka. "
                "Buka dulu file PPT-nya!"
            )
        return self.app.ActivePresentation

    def _ensure_active_slide(self):
        try:
            return self.app.ActiveWindow.View.Slide
        except Exception:
            pres = self._ensure_active_presentation()
            if pres.Slides.Count > 0:
                return pres.Slides(1)
            raise RuntimeError("Tidak ada slide di presentasi ini.")

    # ═══════════════════════════════════════════════════════════
    # 🔍 READ
    # ═══════════════════════════════════════════════════════════

    def _get_active_presentation(self, cmd):
        pres = self._ensure_active_presentation()

        info = {
            "name": pres.Name,
            "path": pres.FullName,
            "slides": pres.Slides.Count,
            "slide_width": pres.PageSetup.SlideWidth,
            "slide_height": pres.PageSetup.SlideHeight,
        }
        return info

    def _get_current_slide(self, cmd):
        slide = self._ensure_active_slide()

        shapes = []
        for shape in slide.Shapes:
            shape_info = {
                "name": shape.Name,
                "type": shape.Type,
                "has_text": shape.HasTextFrame > 0,
            }
            if shape.HasTextFrame > 0 and shape.TextFrame.HasText > 0:
                shape_info["text"] = shape.TextFrame.TextRange.Text[:200]
            shapes.append(shape_info)

        return {
            "slide_index": slide.SlideIndex,
            "layout": slide.CustomLayout.Name if slide.CustomLayout else "unknown",
            "shapes": len(shapes),
            "shape_details": shapes,
        }

    def _get_all_slides(self, cmd):
        pres = self._ensure_active_presentation()
        max_slides = cmd.get("max_slides", 50)

        slides = []
        for i in range(1, min(pres.Slides.Count, max_slides) + 1):
            slide = pres.Slides(i)
            slide_info = {
                "index": slide.SlideIndex,
                "layout": slide.CustomLayout.Name if slide.CustomLayout else "unknown",
                "shapes": slide.Shapes.Count,
            }
            slides.append(slide_info)

        return {
            "total": pres.Slides.Count,
            "returned": len(slides),
            "slides": slides,
        }

    def _get_slide_content(self, cmd):
        pres = self._ensure_active_presentation()
        slide_num = cmd.get("slide", 1)

        if slide_num < 1 or slide_num > pres.Slides.Count:
            raise ValueError(f"Slide {slide_num} tidak ada. Total slide: {pres.Slides.Count}")

        slide = pres.Slides(slide_num)
        texts = []
        for shape in slide.Shapes:
            if shape.HasTextFrame > 0:
                try:
                    txt = shape.TextFrame.TextRange.Text
                    texts.append({
                        "shape": shape.Name,
                        "text": txt[:500],
                    })
                except Exception:
                    pass

        return {
            "slide": slide_num,
            "text_elements": texts,
            "total_texts": len(texts),
        }

    # ═══════════════════════════════════════════════════════════
    # ✍️ WRITE
    # ═══════════════════════════════════════════════════════════

    def _write_to_slide(self, cmd):
        """Tulis teks ke placeholder/shape tertentu di slide."""
        slide = self._ensure_active_slide()
        text = cmd.get("text", "")
        placeholder_index = cmd.get("placeholder_index", None)
        shape_name = cmd.get("shape_name", None)

        if not text:
            raise ValueError("Parameter 'text' wajib diisi")

        if shape_name:
            # Cari shape by name
            for shape in slide.Shapes:
                if shape.Name == shape_name and shape.HasTextFrame > 0:
                    shape.TextFrame.TextRange.Text = text
                    return {
                        "action": "write_to_slide",
                        "shape": shape_name,
                        "text": text[:200],
                    }
            raise ValueError(f"Shape '{shape_name}' tidak ditemukan di slide ini")

        if placeholder_index:
            # Cari placeholder by index
            for shape in slide.Shapes:
                if shape.HasTextFrame > 0:
                    try:
                        if shape.PlaceholderFormat is not None:
                            idx = shape.PlaceholderFormat.Index
                            if idx == placeholder_index:
                                shape.TextFrame.TextRange.Text = text
                                return {
                                    "action": "write_to_slide",
                                    "placeholder": placeholder_index,
                                    "text": text[:200],
                                }
                    except Exception:
                        continue
            raise ValueError(f"Placeholder index {placeholder_index} tidak ditemukan")

        # Default: tulis ke shape pertama yang punya text frame kosong
        for shape in slide.Shapes:
            if shape.HasTextFrame > 0:
                try:
                    existing = shape.TextFrame.TextRange.Text.strip()
                    if not existing:
                        shape.TextFrame.TextRange.Text = text
                        return {
                            "action": "write_to_slide",
                            "shape": shape.Name,
                            "text": text[:200],
                        }
                except Exception:
                    continue

        # Fallback: buat textbox baru
        return self._add_textbox(cmd)

    def _add_textbox(self, cmd):
        """Tambah textbox baru di slide aktif."""
        slide = self._ensure_active_slide()
        text = cmd.get("text", "Ketik di sini...")
        left = cmd.get("left", 50)
        top = cmd.get("top", 100)
        width = cmd.get("width", 400)
        height = cmd.get("height", 50)

        textbox = slide.Shapes.AddTextbox(
            1,  # msoTextOrientationHorizontal
            left, top, width, height
        )
        textbox.TextFrame.TextRange.Text = text

        # Format font
        font_size = cmd.get("font_size", 18)
        font_name = cmd.get("font_name", "Calibri")
        textbox.TextFrame.TextRange.Font.Size = font_size
        textbox.TextFrame.TextRange.Font.Name = font_name

        return {
            "action": "add_textbox",
            "shape": textbox.Name,
            "position": {"left": left, "top": top},
            "text": text[:200],
        }

    def _add_text_to_slide(self, cmd):
        """Alias: tambah teks ke slide. Sama dengan add_textbox."""
        return self._add_textbox(cmd)

    # ═══════════════════════════════════════════════════════════
    # 📋 SLIDE MANAGEMENT
    # ═══════════════════════════════════════════════════════════

    def _add_slide(self, cmd):
        """Tambah slide baru."""
        pres = self._ensure_active_presentation()
        layout_name = cmd.get("layout", "blank")

        # Cari layout
        layout_map = {
            "blank": 12,  # ppLayoutBlank
            "title": 1,   # ppLayoutTitle
            "text": 2,    # ppLayoutText
            "two_content": 3,  # ppLayoutTwoContent
            "comparison": 4,   # ppLayoutComparison
            "title_only": 5,   # ppLayoutTitleOnly
        }

        layout_type = layout_map.get(layout_name.lower(), 12)

        # Dapatkan desired layout
        design = pres.SlideMaster.CustomLayouts
        target_layout = None
        for i in range(1, design.Count + 1):
            if design(i).Index == layout_type:
                target_layout = design(i)
                break

        if not target_layout and design.Count > 0:
            target_layout = design(1)

        if target_layout:
            new_slide = pres.Slides.AddSlide(
                pres.Slides.Count + 1, target_layout
            )
        else:
            new_slide = pres.Slides.Add(pres.Slides.Count + 1, layout_type)

        return {
            "action": "add_slide",
            "slide_index": new_slide.SlideIndex,
            "layout": layout_name,
        }

    def _delete_slide(self, cmd):
        """Hapus slide."""
        pres = self._ensure_active_presentation()
        slide_num = cmd.get("slide", None)

        if slide_num is None:
            # Hapus slide yang aktif
            slide = self._ensure_active_slide()
            slide_num = slide.SlideIndex

        if slide_num < 1 or slide_num > pres.Slides.Count:
            raise ValueError(f"Slide {slide_num} tidak valid")

        pres.Slides(slide_num).Delete()
        return {"action": "delete_slide", "deleted": slide_num}

    def _duplicate_slide(self, cmd):
        """Duplikasi slide."""
        pres = self._ensure_active_presentation()
        slide_num = cmd.get("slide", None)

        if slide_num is None:
            slide = self._ensure_active_slide()
            slide_num = slide.SlideIndex

        if slide_num < 1 or slide_num > pres.Slides.Count:
            raise ValueError(f"Slide {slide_num} tidak valid")

        pres.Slides(slide_num).Duplicate()
        return {"action": "duplicate_slide", "source": slide_num}

    def _move_slide(self, cmd):
        """Pindah slide ke posisi baru."""
        pres = self._ensure_active_presentation()
        slide_num = cmd.get("slide", None)
        new_position = cmd.get("to", 1)

        if slide_num is None:
            slide = self._ensure_active_slide()
            slide_num = slide.SlideIndex

        pres.Slides(slide_num).MoveTo(new_position)
        return {"action": "move_slide", "from": slide_num, "to": new_position}

    # ═══════════════════════════════════════════════════════════
    # 🎨 FORMAT
    # ═══════════════════════════════════════════════════════════

    def _format_slide(self, cmd):
        """Format slide: background, dll."""
        pres = self._ensure_active_presentation()
        slide = self._ensure_active_slide()
        background_color = cmd.get("background_color", None)

        if background_color is not None:
            slide.Background.Fill.ForeColor.RGB = background_color
            slide.Background.Fill.Visible = 1

        return {"action": "format_slide", "slide": slide.SlideIndex}

    def _format_text(self, cmd):
        """Format teks di shape tertentu."""
        slide = self._ensure_active_slide()
        shape_name = cmd.get("shape_name", None)
        shape_index = cmd.get("shape_index", 1)

        if shape_name:
            shape = None
            for s in slide.Shapes:
                if s.Name == shape_name:
                    shape = s
                    break
            if shape is None:
                raise ValueError(f"Shape '{shape_name}' tidak ditemukan")
        else:
            if shape_index > slide.Shapes.Count:
                raise ValueError(f"Shape index {shape_index} tidak valid")
            shape = slide.Shapes(shape_index)

        if shape.HasTextFrame == 0:
            raise ValueError(f"Shape '{shape.Name}' tidak memiliki text frame")

        text_range = shape.TextFrame.TextRange
        changes = []

        if "bold" in cmd:
            text_range.Font.Bold = 1 if cmd["bold"] else 0
            changes.append(f"bold={cmd['bold']}")
        if "italic" in cmd:
            text_range.Font.Italic = 1 if cmd["italic"] else 0
            changes.append(f"italic={cmd['italic']}")
        if "font_size" in cmd:
            text_range.Font.Size = cmd["font_size"]
            changes.append(f"font_size={cmd['font_size']}")
        if "font_name" in cmd:
            text_range.Font.Name = cmd["font_name"]
            changes.append(f"font_name={cmd['font_name']}")
        if "font_color" in cmd:
            text_range.Font.Color.RGB = cmd["font_color"]
            changes.append(f"font_color={cmd['font_color']}")
        if "alignment" in cmd:
            align_map = {"left": 1, "center": 2, "right": 3, "justify": 4}
            text_range.ParagraphFormat.Alignment = align_map.get(
                cmd["alignment"].lower(), 2
            )
            changes.append(f"alignment={cmd['alignment']}")

        return {"action": "format_text", "shape": shape.Name, "changes": changes}

    def _change_layout(self, cmd):
        """Ubah layout slide."""
        slide = self._ensure_active_slide()
        layout_name = cmd.get("layout", "blank")

        layout_map = {
            "blank": 12,
            "title": 1,
            "text": 2,
            "two_content": 3,
            "comparison": 4,
            "title_only": 5,
        }

        layout_type = layout_map.get(layout_name.lower(), 12)

        pres = self._ensure_active_presentation()
        design = pres.SlideMaster.CustomLayouts
        for i in range(1, design.Count + 1):
            if design(i).Index == layout_type:
                slide.CustomLayout = design(i)
                return {
                    "action": "change_layout",
                    "slide": slide.SlideIndex,
                    "new_layout": layout_name,
                }

        raise ValueError(f"Layout '{layout_name}' tidak tersedia")

    def _apply_theme(self, cmd):
        """Apply theme ke presentasi."""
        pres = self._ensure_active_presentation()
        theme_path = cmd.get("theme_path", "")

        if not theme_path:
            raise ValueError("Parameter 'theme_path' wajib diisi (path ke file .thmx)")

        pres.ApplyTheme(theme_path)
        return {"action": "apply_theme", "theme": theme_path}

    def _set_transition(self, cmd):
        """Set transisi slide."""
        slide = self._ensure_active_slide()
        transition_type = cmd.get("transition", "fade")
        duration = cmd.get("duration", 1.0)

        # Map transition names (partial list)
        trans_map = {
            "none": 0,
            "fade": 1,
            "push": 2,
            "wipe": 3,
            "split": 4,
            "uncover": 5,
            "cover": 6,
            "zoom": 7,
        }

        trans_type = trans_map.get(transition_type.lower(), 1)
        slide.SlideShowTransition.EntryEffect = trans_type
        slide.SlideShowTransition.Duration = duration

        return {
            "action": "set_transition",
            "transition": transition_type,
            "duration": duration,
        }

    # ═══════════════════════════════════════════════════════════
    # 🖼️ IMAGE & SHAPE
    # ═══════════════════════════════════════════════════════════

    def _add_image(self, cmd):
        """Tambah gambar ke slide."""
        slide = self._ensure_active_slide()
        image_path = cmd.get("image_path", "")
        left = cmd.get("left", 50)
        top = cmd.get("top", 50)
        width = cmd.get("width", None)
        height = cmd.get("height", None)

        if not image_path:
            raise ValueError("Parameter 'image_path' wajib diisi")

        import os
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"File gambar tidak ditemukan: {image_path}")

        pic = slide.Shapes.AddPicture(
            image_path, False, True,
            left, top, width or -1, height or -1
        )

        return {
            "action": "add_image",
            "shape": pic.Name,
            "image": image_path,
        }

    def _add_shape(self, cmd):
        """Tambah shape (kotak, lingkaran, dll)."""
        slide = self._ensure_active_slide()
        shape_type = cmd.get("shape", "rectangle")
        left = cmd.get("left", 50)
        top = cmd.get("top", 50)
        width = cmd.get("width", 100)
        height = cmd.get("height", 100)

        # MSO AutoShape types
        shape_map = {
            "rectangle": 1,
            "rounded_rectangle": 5,
            "oval": 9,
            "triangle": 4,
            "arrow": 13,
            "line": 15,
            "heart": 21,
            "star": 12,
            "arrow_right": 33,
            "callout": 105,
        }

        mso_type = shape_map.get(shape_type.lower(), 1)

        shape = slide.Shapes.AddShape(mso_type, left, top, width, height)

        if "fill_color" in cmd:
            shape.Fill.ForeColor.RGB = cmd["fill_color"]
            shape.Fill.Visible = 1

        if "line_color" in cmd:
            shape.Line.ForeColor.RGB = cmd["line_color"]

        return {
            "action": "add_shape",
            "shape": shape.Name,
            "type": shape_type,
        }

    # ═══════════════════════════════════════════════════════════
    # 🧹 SMART
    # ═══════════════════════════════════════════════════════════

    def _fix_font_size(self, cmd):
        """Standardisasi font size di seluruh slide."""
        pres = self._ensure_active_presentation()
        font_size = cmd.get("font_size", 18)
        changed = 0

        for i in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(i)
            for shape in slide.Shapes:
                if shape.HasTextFrame > 0:
                    try:
                        text_range = shape.TextFrame.TextRange
                        if text_range.Font.Size != font_size:
                            text_range.Font.Size = font_size
                            changed += 1
                    except Exception:
                        pass

        return {
            "action": "fix_font_size",
            "font_size": font_size,
            "shapes_changed": changed,
        }

    def _fix_alignment(self, cmd):
        """Standardisasi alignment di semua text."""
        pres = self._ensure_active_presentation()
        alignment = cmd.get("alignment", "left")
        align_map = {"left": 1, "center": 2, "right": 3}
        align_val = align_map.get(alignment.lower(), 1)
        changed = 0

        for i in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(i)
            for shape in slide.Shapes:
                if shape.HasTextFrame > 0:
                    try:
                        shape.TextFrame.TextRange.ParagraphFormat.Alignment = align_val
                        changed += 1
                    except Exception:
                        pass

        return {
            "action": "fix_alignment",
            "alignment": alignment,
            "shapes_changed": changed,
        }

    def _fix_bullet_spacing(self, cmd):
        """Rapihkan spacing antar bullet point."""
        pres = self._ensure_active_presentation()
        changed = 0

        for i in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(i)
            for shape in slide.Shapes:
                if shape.HasTextFrame > 0:
                    try:
                        pf = shape.TextFrame.TextRange.ParagraphFormat
                        pf.SpaceBefore = 6
                        pf.SpaceAfter = 6
                        changed += 1
                    except Exception:
                        pass

        return {
            "action": "fix_bullet_spacing",
            "shapes_changed": changed,
        }


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = PowerPointBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()

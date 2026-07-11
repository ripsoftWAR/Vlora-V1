"""
excel_bridge.py — Microsoft Excel COM Automation Bridge.

Mode operasi:
  - Mode 1 (Ghost): inject data langsung ke cell aktif
  - Mode 2 (Batch): tulis range/formula tanpa mengganggu seleksi
  - Mode 3 (Read): baca data ribuan baris untuk analisis AI

Contoh command via stdin:
  {"action": "get_active_workbook"}
  {"action": "get_selection"}
  {"action": "get_range", "range": "A1:C10", "include_formulas": true}
  {"action": "write_cell", "cell": "A1", "value": "Hello from AI"}
  {"action": "write_range", "range": "A1:C3", "data": [["a","b","c"],[1,2,3]]}
  {"action": "find_errors", "range": "A1:Z1000"}
  {"action": "apply_formula", "range": "D1:D10", "formula": "=SUM(A1:C1)"}
  {"action": "format_range", "range": "A1:Z1000", "bold": true}
  {"action": "exit"}
"""

import time
import traceback
from desktop.office_base import OfficeBridge


class ExcelBridge(OfficeBridge):
    APP_NAME = "Excel.Application"

    def connect(self):
        super().connect()
        # Matikan events biar tidak trigger macro
        self.app.EnableEvents = True  # Tetap aktif untuk live feedback
        self.app.DisplayAlerts = False  # Matikan popup konfirmasi
        self.app.ScreenUpdating = True  # Biar user lihat perubahan
        return True

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        handlers = {
            # ── Baca ──
            "get_active_workbook": self._get_active_workbook,
            "get_selection": self._get_selection,
            "get_range": self._get_range,
            "get_used_range": self._get_used_range,
            "find_in_range": self._find_in_range,
            "find_errors": self._find_errors,

            # ── Tulis ──
            "write_cell": self._write_cell,
            "write_range": self._write_range,
            "write_at_cursor": self._write_at_cursor,
            "insert_row": self._insert_row,
            "insert_column": self._insert_column,

            # ── Edit / Format ──
            "format_range": self._format_range,
            "format_cells": self._format_range,  # alias
            "apply_formula": self._apply_formula,
            "apply_auto_fill": self._apply_auto_fill,
            "auto_fit_columns": self._auto_fit_columns,
            "auto_fit_rows": self._auto_fit_rows,
            "merge_cells": self._merge_cells,
            "unmerge_cells": self._unmerge_cells,
            "clear_range": self._clear_range,
            "delete_range": self._delete_range,
            "sort_range": self._sort_range,
            "filter_range": self._filter_range,

            # ── Cerdas ──
            "find_typos_in_text": self._find_typos_in_text,
            "find_inconsistencies": self._find_inconsistencies,
            "highlight_duplicates": self._highlight_duplicates,
            "fix_number_format": self._fix_number_format,
            "normalize_text": self._normalize_text,

            # ── Chart ──
            "create_chart": self._create_chart,

            # ── Workbook ──
            "add_sheet": self._add_sheet,
            "rename_sheet": self._rename_sheet,
            "delete_sheet": self._delete_sheet,
        }

        handler = handlers.get(action)
        if handler is None:
            raise ValueError(
                f"Action '{action}' tidak dikenal. "
                f"Yang tersedia: {', '.join(handlers.keys())}"
            )
        return handler(cmd)

    # ── Ensure workbook ───────────────────────────────────────────

    def _ensure_active_workbook(self):
        if self.app.Workbooks.Count == 0:
            raise RuntimeError(
                "Tidak ada workbook Excel yang terbuka. "
                "Buka dulu file Excelnya!"
            )
        return self.app.ActiveWorkbook

    def _ensure_active_sheet(self):
        wb = self._ensure_active_workbook()
        try:
            return wb.ActiveSheet
        except Exception:
            raise RuntimeError("Tidak ada sheet aktif di workbook ini.")

    # ═══════════════════════════════════════════════════════════
    # 🔍 READ
    # ═══════════════════════════════════════════════════════════

    def _get_active_workbook(self, cmd):
        wb = self._ensure_active_workbook()
        ws = wb.ActiveSheet
        used = ws.UsedRange

        info = {
            "name": wb.Name,
            "path": wb.FullName,
            "sheets": wb.Sheets.Count,
            "active_sheet": ws.Name,
            "used_range": {
                "rows": used.Rows.Count,
                "columns": used.Columns.Count,
                "address": used.Address,
            },
        }
        return info

    def _get_selection(self, cmd):
        try:
            sel = self.app.Selection
            info = {
                "address": sel.Address,
                "rows": sel.Rows.Count,
                "columns": sel.Columns.Count,
                "value": sel.Value,
            }
            return info
        except Exception as e:
            return {"error": str(e), "address": "unknown"}

    def _get_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "A1")
        include_formulas = cmd.get("include_formulas", False)

        try:
            rng = ws.Range(range_str)
        except Exception as e:
            raise ValueError(f"Range '{range_str}' tidak valid: {e}")

        data = []
        for row in rng.Rows:
            row_data = []
            for cell in row.Columns:
                val = cell.Value
                if include_formulas and cell.HasFormula:
                    val = {"value": val, "formula": cell.Formula}
                row_data.append(val)
            data.append(row_data)

        return {
            "range": range_str,
            "rows": rng.Rows.Count,
            "columns": rng.Columns.Count,
            "data": data,
        }

    def _get_used_range(self, cmd):
        ws = self._ensure_active_sheet()
        used = ws.UsedRange
        include_formulas = cmd.get("include_formulas", False)
        max_rows = cmd.get("max_rows", 1000)

        data = []
        row_count = min(used.Rows.Count, max_rows)

        for i in range(1, row_count + 1):
            row_data = []
            for j in range(1, used.Columns.Count + 1):
                cell = used.Cells(i, j)
                val = cell.Value
                if include_formulas and cell.HasFormula:
                    val = {"value": val, "formula": cell.Formula}
                row_data.append(val)
            data.append(row_data)

        return {
            "address": used.Address,
            "total_rows": used.Rows.Count,
            "total_cols": used.Columns.Count,
            "returned_rows": row_count,
            "truncated": row_count < used.Rows.Count,
            "data": data,
        }

    def _find_in_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        query = cmd.get("query", "")

        if not query:
            raise ValueError("Parameter 'query' wajib diisi")

        rng = ws.Range(range_str)
        found = rng.Find(query)

        if found is None:
            return {"found": False, "query": query}

        results = []
        first_address = found.Address
        while True:
            results.append({
                "address": found.Address,
                "value": str(found.Value),
                "row": found.Row,
                "column": found.Column,
            })
            found = rng.FindNext(found)
            if found is None or found.Address == first_address:
                break

        return {"found": True, "query": query, "count": len(results), "results": results}

    def _find_errors(self, cmd):
        """Cari semua cell error di range tertentu."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)

        rng = ws.Range(range_str)
        errors = []

        for row in rng.Rows:
            for cell in row.Columns:
                val = cell.Value
                if val is not None and isinstance(val, str) and val.startswith("#"):
                    errors.append({
                        "address": cell.Address,
                        "error": val,
                        "formula": cell.Formula if cell.HasFormula else None,
                    })

        return {
            "range": range_str,
            "total_errors": len(errors),
            "errors": errors[:100],  # max 100 detail
        }

    # ═══════════════════════════════════════════════════════════
    # ✍️ WRITE
    # ═══════════════════════════════════════════════════════════

    def _write_cell(self, cmd):
        ws = self._ensure_active_sheet()
        cell_ref = cmd.get("cell", "A1")
        value = cmd.get("value", "")

        ws.Range(cell_ref).Value = value

        return {
            "action": "write_cell",
            "cell": cell_ref,
            "value": str(value)[:200],
        }

    def _write_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "A1")
        data = cmd.get("data", [])

        if not data:
            raise ValueError("Parameter 'data' wajib diisi (array 2D)")

        rng = ws.Range(range_str)
        rows = len(data)
        cols = max(len(row) for row in data) if data else 0

        # Pastikan range cukup besar
        if rng.Rows.Count < rows or rng.Columns.Count < cols:
            target_range = ws.Range(
                rng.Cells(1, 1),
                rng.Cells(rows, cols)
            )
        else:
            target_range = rng

        # Convert to 2D array for Excel
        excel_data = []
        for row in data:
            excel_row = []
            for cell in row:
                excel_row.append(cell)
            # Pad with None
            while len(excel_row) < cols:
                excel_row.append(None)
            excel_data.append(excel_row)

        target_range.Value = excel_data

        return {
            "action": "write_range",
            "range": target_range.Address,
            "rows": rows,
            "cols": cols,
        }

    def _write_at_cursor(self, cmd):
        """Tulis di cell yang sedang aktif (seperti ghost typing)."""
        value = cmd.get("value", "")
        if not value:
            raise ValueError("Parameter 'value' wajib diisi")

        active_cell = self.app.ActiveCell
        active_cell.Value = value

        return {
            "action": "write_at_cursor",
            "cell": active_cell.Address,
            "value": str(value)[:200],
        }

    def _insert_row(self, cmd):
        ws = self._ensure_active_sheet()
        row_num = cmd.get("row", 1)
        count = cmd.get("count", 1)

        ws.Range(f"{row_num}:{row_num + count - 1}").Insert()

        return {"action": "insert_row", "row": row_num, "count": count}

    def _insert_column(self, cmd):
        ws = self._ensure_active_sheet()
        col_letter = cmd.get("column", "A")
        count = cmd.get("count", 1)

        col_num = ord(col_letter.upper()) - ord('A') + 1
        end_col = col_num + count - 1

        def to_col_letter(n):
            result = ""
            while n > 0:
                n -= 1
                result = chr(65 + n % 26) + result
                n //= 26
            return result

        ws.Range(f"{col_letter}:{to_col_letter(end_col)}").Insert()

        return {"action": "insert_column", "column": col_letter, "count": count}

    # ═══════════════════════════════════════════════════════════
    # 🎨 FORMAT
    # ═══════════════════════════════════════════════════════════

    def _format_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "A1")
        rng = ws.Range(range_str)

        changes = []

        # Font
        if "bold" in cmd:
            rng.Font.Bold = cmd["bold"]
            changes.append(f"bold={cmd['bold']}")
        if "italic" in cmd:
            rng.Font.Italic = cmd["italic"]
            changes.append(f"italic={cmd['italic']}")
        if "font_size" in cmd:
            rng.Font.Size = cmd["font_size"]
            changes.append(f"font_size={cmd['font_size']}")
        if "font_name" in cmd:
            rng.Font.Name = cmd["font_name"]
            changes.append(f"font_name={cmd['font_name']}")
        if "font_color" in cmd:
            rng.Font.Color = cmd["font_color"]
            changes.append(f"font_color={cmd['font_color']}")
        if "background_color" in cmd:
            rng.Interior.Color = cmd["background_color"]
            changes.append(f"background_color={cmd['background_color']}")

        # Alignment
        if "horizontal_alignment" in cmd:
            align_map = {"left": -4131, "center": -4108, "right": -4152}
            rng.HorizontalAlignment = align_map.get(cmd["horizontal_alignment"].lower(), -4108)
            changes.append(f"horizontal={cmd['horizontal_alignment']}")
        if "vertical_alignment" in cmd:
            v_align_map = {"top": -4160, "center": -4108, "bottom": -4107}
            rng.VerticalAlignment = v_align_map.get(cmd["vertical_alignment"].lower(), -4108)
            changes.append(f"vertical={cmd['vertical_alignment']}")
        if "wrap_text" in cmd:
            rng.WrapText = cmd["wrap_text"]
            changes.append(f"wrap_text={cmd['wrap_text']}")

        # Number format
        if "number_format" in cmd:
            rng.NumberFormat = cmd["number_format"]
            changes.append(f"number_format={cmd['number_format']}")

        # Border
        if "border" in cmd:
            from win32com.client import constants as const
            borders = rng.Borders
            borders.LineStyle = 1  # xlContinuous
            borders.Weight = 2     # xlThin
            changes.append("border=thin")

        return {"action": "format_range", "range": range_str, "changes": changes}

    def _apply_formula(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "A1")
        formula = cmd.get("formula", "")

        if not formula:
            raise ValueError("Parameter 'formula' wajib diisi")

        rng = ws.Range(range_str)
        rng.Formula = formula

        return {
            "action": "apply_formula",
            "range": range_str,
            "formula": formula,
        }

    def _apply_auto_fill(self, cmd):
        ws = self._ensure_active_sheet()
        source = cmd.get("source", "")
        destination = cmd.get("destination", "")

        if not source or not destination:
            raise ValueError("Parameter 'source' dan 'destination' wajib diisi")

        ws.Range(source).AutoFill(ws.Range(destination))

        return {"action": "apply_auto_fill", "source": source, "destination": destination}

    def _auto_fit_columns(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        ws.Range(range_str).Columns.AutoFit()
        return {"action": "auto_fit_columns", "range": range_str}

    def _auto_fit_rows(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        ws.Range(range_str).Rows.AutoFit()
        return {"action": "auto_fit_rows", "range": range_str}

    def _merge_cells(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "")
        if not range_str:
            raise ValueError("Parameter 'range' wajib diisi")
        ws.Range(range_str).Merge()
        return {"action": "merge_cells", "range": range_str}

    def _unmerge_cells(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "")
        if not range_str:
            raise ValueError("Parameter 'range' wajib diisi")
        ws.Range(range_str).UnMerge()
        return {"action": "unmerge_cells", "range": range_str}

    def _clear_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "")
        if not range_str:
            raise ValueError("Parameter 'range' wajib diisi")
        ws.Range(range_str).Clear()
        return {"action": "clear_range", "range": range_str}

    def _delete_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "")
        shift = cmd.get("shift", "up")  # 'up' | 'left'
        if not range_str:
            raise ValueError("Parameter 'range' wajib diisi")

        shift_map = {"up": -4162, "left": -4159}
        ws.Range(range_str).Delete(Shift=shift_map.get(shift, -4162))

        return {"action": "delete_range", "range": range_str, "shift": shift}

    def _sort_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        key_column = cmd.get("key_column", 1)
        order = cmd.get("order", "asc")  # 'asc' | 'desc'

        rng = ws.Range(range_str)
        order_const = 1 if order == "asc" else 2  # xlAscending / xlDescending

        rng.Sort(
            Key1=rng.Columns(key_column),
            Order1=order_const,
            Header=cmd.get("has_header", False)
        )

        return {"action": "sort_range", "range": range_str, "order": order}

    def _filter_range(self, cmd):
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        field = cmd.get("field", 1)
        criteria = cmd.get("criteria", "")

        rng = ws.Range(range_str)
        rng.AutoFilter(Field=field, Criteria1=criteria)

        return {"action": "filter_range", "range": range_str, "field": field, "criteria": criteria}

    # ═══════════════════════════════════════════════════════════
    # 🧹 SMART
    # ═══════════════════════════════════════════════════════════

    def _find_typos_in_text(self, cmd):
        """Cari potensi typo di cell teks."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)

        rng = ws.Range(range_str)
        typos = []
        common_typos = {
            "teh": "the", "dgn": "dengan", "utk": "untuk",
            "jg": "juga", "tdk": "tidak", "krn": "karena",
            "spt": "seperti", "dpt": "dapat", "sbg": "sebagai",
            "sbb": "sebab", "msh": "masih", "blm": "belum",
            "sdh": "sudah", "bs": "bisa", "aja": "saja",
        }

        for row in rng.Rows:
            for cell in row.Columns:
                val = cell.Value
                if val is not None and isinstance(val, str):
                    for typo, correct in common_typos.items():
                        if typo in val.lower().split():
                            typos.append({
                                "address": cell.Address,
                                "original": val[:100],
                                "typo": typo,
                                "suggestion": correct,
                            })

        return {
            "range": range_str,
            "total_suspected": len(typos),
            "typos": typos[:50],
        }

    def _find_inconsistencies(self, cmd):
        """Cari inkonsistensi data (format campuran, dll)."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)

        rng = ws.Range(range_str)
        inconsistencies = []

        # Cek perbedaan format dalam satu kolom
        for col in range(1, rng.Columns.Count + 1):
            formats = {}
            for row in range(1, rng.Rows.Count + 1):
                cell = rng.Cells(row, col)
                fmt = cell.NumberFormat
                if fmt not in formats:
                    formats[fmt] = []
                formats[fmt].append(cell.Address)

            if len(formats) > 1:
                inconsistencies.append({
                    "column": col,
                    "issue": "mixed_format",
                    "formats": {k: len(v) for k, v in formats.items()},
                })

        return {
            "range": range_str,
            "total_inconsistencies": len(inconsistencies),
            "details": inconsistencies,
        }

    def _highlight_duplicates(self, cmd):
        """Highlight duplicate values."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)

        rng = ws.Range(range_str)
        color = cmd.get("color", 255)  # Default red

        # Gunakan conditional formatting untuk highlight duplikat
        from win32com.client import constants as const
        fc = rng.FormatConditions.Add(
            Type=1,  # xlCellValue
            Operator=1,  # xlEqual
            Formula1=f"=COUNTIF({rng.Address}, {rng.Cells(1, 1).Address})>1"
        )
        fc.Interior.Color = color

        return {"action": "highlight_duplicates", "range": range_str}

    def _fix_number_format(self, cmd):
        """Perbaiki format angka yang kacau."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)

        rng = ws.Range(range_str)
        fixed = 0

        for row in rng.Rows:
            for cell in row.Columns:
                val = cell.Value
                if val is not None and isinstance(val, str):
                    # Coba deteksi angka yang ke-save sebagai teks
                    try:
                        float(val.replace(",", "."))
                        cell.Value = float(val.replace(",", "."))
                        cell.NumberFormat = "0.00"
                        fixed += 1
                    except (ValueError, TypeError):
                        pass

        return {
            "action": "fix_number_format",
            "range": range_str,
            "fixed_cells": fixed,
        }

    def _normalize_text(self, cmd):
        """Normalisasi teks: trim, proper case, dll."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", ws.UsedRange.Address)
        mode = cmd.get("mode", "trim")  # 'trim' | 'proper' | 'upper' | 'lower'

        rng = ws.Range(range_str)
        changed = 0

        for row in rng.Rows:
            for cell in row.Columns:
                val = cell.Value
                if val is not None and isinstance(val, str):
                    old = val
                    if mode == "trim":
                        new = val.strip()
                    elif mode == "proper":
                        new = val.strip().title()
                    elif mode == "upper":
                        new = val.strip().upper()
                    elif mode == "lower":
                        new = val.strip().lower()
                    else:
                        new = val.strip()

                    if new != old:
                        cell.Value = new
                        changed += 1

        return {"action": "normalize_text", "range": range_str, "mode": mode, "changed": changed}

    # ═══════════════════════════════════════════════════════════
    # 📊 CHART
    # ═══════════════════════════════════════════════════════════

    def _create_chart(self, cmd):
        """Buat chart dari range data."""
        ws = self._ensure_active_sheet()
        range_str = cmd.get("range", "")
        chart_type = cmd.get("chart_type", "column")  # 'column', 'bar', 'line', 'pie'
        title = cmd.get("title", "Chart")
        include_legend = cmd.get("include_legend", True)

        if not range_str:
            raise ValueError("Parameter 'range' wajib diisi (data source)")

        chart_types = {
            "column": -4100,  # xlColumnClustered
            "bar": -4098,     # xlBarClustered
            "line": 4,        # xlLine
            "pie": 5,         # xlPie
            "area": 1,        # xlArea
            "doughnut": -4120,  # xlDoughnut
        }

        chart_obj = ws.ChartObjects().Add(
            Left=100, Width=375, Top=50, Height=225
        )
        chart = chart_obj.Chart
        chart.SetSourceData(ws.Range(range_str))
        chart.ChartType = chart_types.get(chart_type.lower(), -4100)
        chart.HasTitle = True
        chart.ChartTitle.Text = title
        chart.HasLegend = include_legend

        return {
            "action": "create_chart",
            "type": chart_type,
            "title": title,
            "position": chart_obj.TopLeftCell.Address,
        }

    # ═══════════════════════════════════════════════════════════
    # 📋 SHEET MANAGEMENT
    # ═══════════════════════════════════════════════════════════

    def _add_sheet(self, cmd):
        wb = self._ensure_active_workbook()
        name = cmd.get("name", None)
        after = cmd.get("after", None)

        # Add sheet
        new_sheet = wb.Sheets.Add()
        if name:
            new_sheet.Name = name

        return {
            "action": "add_sheet",
            "name": new_sheet.Name,
        }

    def _rename_sheet(self, cmd):
        wb = self._ensure_active_workbook()
        old_name = cmd.get("old_name", "")
        new_name = cmd.get("new_name", "")

        if not old_name or not new_name:
            raise ValueError("Parameter 'old_name' dan 'new_name' wajib diisi")

        ws = wb.Sheets(old_name)
        ws.Name = new_name

        return {"action": "rename_sheet", "old_name": old_name, "new_name": new_name}

    def _delete_sheet(self, cmd):
        wb = self._ensure_active_workbook()
        name = cmd.get("name", "")
        if not name:
            raise ValueError("Parameter 'name' wajib diisi")

        self.app.DisplayAlerts = False
        wb.Sheets(name).Delete()
        self.app.DisplayAlerts = False

        return {"action": "delete_sheet", "deleted": name}


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = ExcelBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()

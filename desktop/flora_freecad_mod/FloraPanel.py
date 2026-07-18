# 🌸 Flora Panel — Qt Native Side Panel untuk FreeCAD
# 
# Panel QDockWidget yang tampilannya mirip UI React Flora
# Dark theme, chat-based interface, terintegrasi dengan backend Flora

import FreeCAD as App
import FreeCADGui as Gui
import sys
import os
import json
import re
import threading
import time
from datetime import datetime

# ── Qt imports (fallback PySide6 → PySide2 → PySide) ────────
try:
    from PySide6 import QtCore, QtGui, QtWidgets
    from PySide6.QtCore import Qt
except ImportError:
    try:
        from PySide2 import QtCore, QtGui, QtWidgets
        from PySide2.QtCore import Qt
    except ImportError:
        from PySide import QtCore, QtGui, QtWidgets
        from PySide.QtCore import Qt

# ── Warna & Style ────────────────────────────────────────────
COLOR_BG = "#0a0a0f"
COLOR_SURFACE = "#12121a"
COLOR_BORDER = "#1e1e2a"
COLOR_TEXT_PRIMARY = "#d4d4d8"
COLOR_TEXT_SECONDARY = "#7f7f8a"
COLOR_TEXT_TERTIARY = "#52525b"
COLOR_ACCENT = "#818cf8"
COLOR_USER_BUBBLE = "#1e1e2e"
COLOR_TOOL_RUNNING = "#34d399"
COLOR_TOOL_DONE = "#34d399"
COLOR_TOOL_ERROR = "#f87171"
COLOR_INPUT_BG = "#181825"
COLOR_HOVER = "#1a1a2e"
COLOR_CODE_BG = "#0d0d14"

FONT_FAMILY = "Segoe UI, -apple-system, sans-serif"
FONT_MONO = "Cascadia Code, Consolas, monospace"
FONT_SIZE = 13
FONT_SIZE_SMALL = 11
FONT_SIZE_LARGE = 15

STYLE_APP = f"""
QWidget {{
    font-family: {FONT_FAMILY};
    font-size: {FONT_SIZE}px;
    color: {COLOR_TEXT_PRIMARY};
    background-color: {COLOR_BG};
}}
QScrollBar:vertical {{
    width: 6px;
    background: transparent;
}}
QScrollBar::handle:vertical {{
    background: {COLOR_BORDER};
    border-radius: 3px;
    min-height: 30px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
    background: transparent;
}}
"""

# ── Instance global ──────────────────────────────────────────
_panel_instance = None

# ── API URL ──────────────────────────────────────────────────
API_URL = "http://localhost:5000"

# ── Helper: style bubble ─────────────────────────────────────
def _make_bubble_style(is_user=False):
    if is_user:
        return f"""
            background-color: {COLOR_USER_BUBBLE};
            border: 1px solid {COLOR_BORDER};
            border-radius: 15px 15px 4px 15px;
            padding: 10px 16px;
            color: {COLOR_TEXT_PRIMARY};
            font-size: {FONT_SIZE}px;
        """
    else:
        return f"""
            background-color: transparent;
            border: none;
            padding: 0px;
            color: {COLOR_TEXT_SECONDARY};
            font-size: {FONT_SIZE}px;
        """

def _make_code_block_style():
    return f"""
        background-color: {COLOR_CODE_BG};
        border: 1px solid {COLOR_BORDER};
        border-radius: 8px;
        padding: 12px;
        font-family: {FONT_MONO};
        font-size: {FONT_SIZE_SMALL}px;
        color: {COLOR_TEXT_PRIMARY};
    """

# ── APIClient ────────────────────────────────────────────────
class APIClient(QtCore.QObject):
    """Async HTTP client untuk komunikasi dengan backend Flora."""

    message_token = QtCore.Signal(str)
    tool_started = QtCore.Signal(str, object)
    tool_ended = QtCore.Signal(str, str)
    stream_done = QtCore.Signal()
    stream_error = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._abort = False

    def send_message(self, query):
        """Kirim pesan ke backend via SSE streaming (async thread)."""
        self._abort = False
        thread = threading.Thread(target=self._stream, args=(query,), daemon=True)
        thread.start()

    def stop(self):
        self._abort = True

    def _stream(self, query):
        try:
            import urllib.request
            import urllib.error

            data = json.dumps({"query": query}).encode("utf-8")
            req = urllib.request.Request(
                f"{API_URL}/api/analyze/stream",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            resp = urllib.request.urlopen(req, timeout=60)
            buffer = ""

            while not self._abort:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                while "\n\n" in buffer:
                    idx = buffer.index("\n\n")
                    block = buffer[:idx]
                    buffer = buffer[idx + 2:]

                    event_type = ""
                    data_str = ""
                    for line in block.split("\n"):
                        if line.startswith("event: "):
                            event_type = line[7:].strip()
                        elif line.startswith("data: "):
                            data_str = line[6:]

                    if not event_type or not data_str:
                        continue

                    try:
                        payload = json.loads(data_str)

                        if event_type == "tool_start":
                            name = payload.get("name", "")
                            args = payload.get("args", {})
                            self.tool_started.emit(name, args)

                        elif event_type == "tool_end":
                            name = payload.get("name", "")
                            preview = payload.get("preview", "")
                            self.tool_ended.emit(name, preview)

                        elif event_type == "token":
                            text = payload.get("text", "")
                            self.message_token.emit(text)

                        elif event_type == "error":
                            self.stream_error.emit(payload.get("message", "Unknown error"))

                    except json.JSONDecodeError:
                        pass

            if not self._abort:
                self.stream_done.emit()

        except Exception as e:
            if not self._abort:
                self.stream_error.emit(str(e))

# ── ChatBubble Widget ────────────────────────────────────────
class ChatBubble(QtWidgets.QWidget):
    """Widget untuk satu pesan chat — mirip ChatMessage.tsx
    Support LIVE STREAMING: set_text() dan add_tool_card() tanpa destroy widget.
    """

    def __init__(self, role, content="", blocks=None, parent=None):
        super().__init__(parent)
        self._role = role
        self._blocks = list(blocks) if blocks else []
        self._is_user = role == "user"
        self._text_label = None   # QLabel teks — dibuat SEKALI, update via setText()
        self._tool_layout = None  # layout khusus untuk tool cards
        self._tool_widgets = {}   # {name: widget}
        self._ts_label = None
        self._init_ui()

    def _init_ui(self):
        layout = QtWidgets.QHBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        # Avatar (hanya untuk assistant)
        if not self._is_user:
            avatar = QtWidgets.QLabel("🌸")
            avatar.setFixedSize(28, 28)
            avatar.setAlignment(Qt.AlignCenter)
            avatar.setStyleSheet(f"""
                QLabel {{
                    background-color: rgba(255,255,255,0.04);
                    border-radius: 14px;
                    font-size: 13px;
                }}
            """)
            layout.addWidget(avatar, 0, Qt.AlignTop)

        # Content wrapper
        self._content_widget = QtWidgets.QWidget()
        self._content_layout = QtWidgets.QVBoxLayout()
        self._content_layout.setContentsMargins(0, 0, 0, 0)
        self._content_layout.setSpacing(4)

        if self._is_user:
            # ── USER BUBBLE ───────────────────────────────
            user_text = ""
            if self._blocks and len(self._blocks) > 0:
                user_text = self._blocks[0].get("text", "")
            self._text_label = QtWidgets.QLabel(self._escape_html(user_text))
            self._text_label.setWordWrap(True)
            self._text_label.setStyleSheet(_make_bubble_style(is_user=True))
            self._text_label.setMaximumWidth(420)
            self._content_layout.addWidget(self._text_label, 0, Qt.AlignRight)
        else:
            # ── ASSISTANT BUBBLE (streaming-ready) ────────
            # Text label — dibuat SEKALI, di-update via setText()
            self._text_label = QtWidgets.QLabel("")
            self._text_label.setWordWrap(True)
            self._text_label.setStyleSheet(f"""
                QLabel {{
                    color: {COLOR_TEXT_SECONDARY};
                    font-size: {FONT_SIZE}px;
                    line-height: 1.6;
                    padding: 2px 0;
                }}
                QLabel a {{ color: {COLOR_ACCENT}; }}
            """)
            self._text_label.setTextFormat(Qt.RichText)
            self._content_layout.addWidget(self._text_label)

            # Tool layout — wadah untuk tool cards (ditambah incremental)
            self._tool_layout = QtWidgets.QVBoxLayout()
            self._tool_layout.setContentsMargins(0, 4, 0, 0)
            self._tool_layout.setSpacing(2)
            self._content_layout.addLayout(self._tool_layout)

            # Initial blocks
            for block in self._blocks:
                if block["type"] == "text":
                    self._text_label.setText(self._render_markdown(block["text"]))
                elif block["type"] == "tool":
                    self._add_tool_card(block)

        # Timestamp
        ts_text = datetime.now().strftime("%H:%M")
        if self._blocks and len(self._blocks) > 0:
            pass  # keep current time
        self._ts_label = QtWidgets.QLabel(ts_text)
        self._ts_label.setStyleSheet(f"color: {COLOR_TEXT_TERTIARY}; font-size: 11px; font-family: {FONT_MONO};")
        align = Qt.AlignRight if self._is_user else Qt.AlignLeft
        self._content_layout.addWidget(self._ts_label, 0, align)

        self._content_widget.setLayout(self._content_layout)

        if self._is_user:
            layout.addStretch()
            layout.addWidget(self._content_widget)
        else:
            layout.addWidget(self._content_widget)
            layout.addStretch()

        self.setLayout(layout)

    # ═══════════════ LIVE STREAMING API ════════════════════════

    def set_text(self, text):
        """Update teks assistant — LIVE, panggil tiap token datang."""
        if self._text_label and not self._is_user:
            html = self._render_markdown(text)
            self._text_label.setText(html)
            self._text_label.update()

    def add_tool_card(self, block):
        """Tambah tool card BARU (tool_start) — tanpa destroy widget."""
        if not self._tool_layout or self._is_user:
            return
        name = block.get("name", "tool")
        if name in self._tool_widgets:
            return  # sudah ada
        card = self._make_tool_card(block)
        self._tool_layout.addWidget(card)
        self._tool_widgets[name] = card

    def update_tool_card(self, name, status, preview=""):
        """Update status tool card yang udah ada (running→done/error)."""
        if name not in self._tool_widgets:
            return
        card = self._tool_widgets[name]
        # Detach old layout
        old_layout = card.layout()
        if old_layout:
            # Buang layout lama
            QtWidgets.QWidget().setLayout(old_layout)

        # Buat layout baru dengan status terkini
        layout = QtWidgets.QHBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Dot
        dot = QtWidgets.QLabel()
        dot.setFixedSize(6, 6)
        color = COLOR_TOOL_RUNNING if status == "running" else (COLOR_TOOL_DONE if status == "done" else COLOR_TOOL_ERROR)
        dot.setStyleSheet(f"background-color: {color}; border-radius: 3px;")
        layout.addWidget(dot, 0, Qt.AlignCenter)

        # Label
        meta = TOOL_META.get(name, {})
        label = QtWidgets.QLabel(meta.get("label", name))
        label.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY if status=='running' else COLOR_TEXT_TERTIARY}; font-size: 13px; font-weight: 500;")
        layout.addWidget(label)

        # Status indicator
        if status == "running":
            pulse = QtWidgets.QLabel("●")
            pulse.setStyleSheet(f"color: {COLOR_TOOL_RUNNING}; font-size: 8px;")
            layout.addWidget(pulse)
        elif status == "done" and preview:
            p = QtWidgets.QLabel(self._escape_html(str(preview)[:50]))
            p.setStyleSheet(f"color: {COLOR_TEXT_TERTIARY}; font-size: 12px; font-family: {FONT_MONO}; font-style: italic;")
            p.setWordWrap(True)
            layout.addWidget(p, 1)
        elif status == "error":
            e = QtWidgets.QLabel("gagal")
            e.setStyleSheet(f"color: {COLOR_TOOL_ERROR}; font-size: 12px;")
            layout.addWidget(e)

        layout.addStretch()
        card.setLayout(layout)
        card.update()

    def live_update(self, blocks):
        """Update konten dari blocks — hanya set_text + add_tool_card. NO DESTROY."""
        if self._is_user:
            return
        self._blocks = list(blocks)
        for block in blocks:
            if block["type"] == "text":
                self.set_text(block.get("text", ""))
            elif block["type"] == "tool":
                name = block.get("name", "")
                status = block.get("status", "running")
                preview = block.get("preview", "")
                if name not in self._tool_widgets:
                    self.add_tool_card(block)
                else:
                    self.update_tool_card(name, status, preview)

    def _escape_html(self, text):
        """Escape HTML special characters."""
        return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))

    def _render_markdown(self, text):
        """Simple markdown → HTML rendering."""
        html = self._escape_html(text)
        # Code blocks
        html_lines = []
        in_code = False
        code_content = []
        for line in html.split("\n"):
            if line.startswith("```"):
                if in_code:
                    # Close code block
                    code_html = "<br>".join(code_content)
                    html_lines.append(
                        f'<div style="{_make_code_block_style()}">{code_html}</div>'
                    )
                    code_content = []
                    in_code = False
                else:
                    in_code = True
            elif in_code:
                code_content.append(line.replace(" ", "&nbsp;"))
            else:
                html_lines.append(line)
        if in_code and code_content:
            code_html = "<br>".join(code_content)
            html_lines.append(
                f'<div style="{_make_code_block_style()}">{code_html}</div>'
            )

        html = "<br>".join(html_lines)

        # Headers
        html = re.sub(r'^### (.+)', r'<b style="font-size:14px;color:#d4d4d8;">\1</b>', html, flags=re.MULTILINE)
        html = re.sub(r'^## (.+)', r'<b style="font-size:15px;color:#d4d4d8;">\1</b>', html, flags=re.MULTILINE)

        # Bold
        html = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', html)
        # Italic
        html = re.sub(r'\*(.+?)\*', r'<i>\1</i>', html)
        # Inline code
        html = re.sub(r'`([^`]+)`', r'<code style="background:#1a1a2e;padding:1px 4px;border-radius:3px;font-family:monospace;">\1</code>', html)
        # Tables (very basic)
        html = re.sub(r'\|(.+?)\|', r'<span style="color:#818cf8;">|\1|</span>', html)

        # Line breaks
        html = html.replace("\n", "<br>")

        return html

    def _make_tool_card(self, block):
        """Buat tool call card — mirip ToolCallCard.tsx"""
        card = QtWidgets.QWidget()
        card.setStyleSheet(f"""
            QWidget {{
                background: transparent;
            }}
        """)
        layout = QtWidgets.QHBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Status dot
        dot = QtWidgets.QLabel()
        dot.setFixedSize(6, 6)
        status = block.get("status", "running")
        if status == "running":
            color = COLOR_TOOL_RUNNING
        elif status == "done":
            color = COLOR_TOOL_DONE
        else:
            color = COLOR_TOOL_ERROR
        dot.setStyleSheet(f"""
            background-color: {color};
            border-radius: 3px;
        """)
        layout.addWidget(dot, 0, Qt.AlignCenter)

        # Label
        tool_name = block.get("name", "tool")
        meta = TOOL_META.get(tool_name, {})
        label_text = meta.get("label", tool_name)
        label = QtWidgets.QLabel(label_text)
        if status == "running":
            label.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY}; font-size: 13px; font-weight: 500;")
        else:
            label.setStyleSheet(f"color: {COLOR_TEXT_TERTIARY}; font-size: 13px; font-weight: 500;")
        layout.addWidget(label)

        if status == "running":
            pulse = QtWidgets.QLabel("●")
            pulse.setStyleSheet(f"color: {COLOR_TOOL_RUNNING}; font-size: 8px;")
            layout.addWidget(pulse)

        elif status == "done" and block.get("preview"):
            preview = QtWidgets.QLabel(self._escape_html(str(block["preview"])[:50]))
            preview.setStyleSheet(f"""
                color: {COLOR_TEXT_TERTIARY};
                font-size: 12px;
                font-family: {FONT_MONO};
                font-style: italic;
            """)
            preview.setWordWrap(True)
            layout.addWidget(preview, 1)

        elif status == "error":
            err_label = QtWidgets.QLabel("gagal")
            err_label.setStyleSheet(f"color: {COLOR_TOOL_ERROR}; font-size: 12px;")
            layout.addWidget(err_label)

        layout.addStretch()
        card.setLayout(layout)
        return card

# ── TOOL_META (subset dari App.tsx) ──────────────────────────
TOOL_META = {
    "read_file": {"label": "Baca file", "color": "#60a5fa"},
    "write_file": {"label": "Tulis file", "color": "#34d399"},
    "edit_file": {"label": "Edit file", "color": "#fbbf24"},
    "delete_file": {"label": "Hapus file", "color": "#f87171"},
    "read_multiple_files": {"label": "Baca beberapa file", "color": "#60a5fa"},
    "list_files": {"label": "List file", "color": "#a78bfa"},
    "find_files": {"label": "Cari file", "color": "#a78bfa"},
    "search_in_files": {"label": "Cari dalam file", "color": "#a78bfa"},
    "run_command": {"label": "Jalankan command", "color": "#fbbf24"},
    "detect_tech_stack": {"label": "Deteksi tech stack", "color": "#34d399"},
    "find_ui_components": {"label": "Cari komponen UI", "color": "#f472b6"},
    "fetch_docs": {"label": "Fetch docs", "color": "#60a5fa"},
    "blender_inject": {"label": "Inject ke Blender", "color": "#f97316"},
    "blender_socket_inject": {"label": "Blender Live", "color": "#f97316"},
    "freecad_inject": {"label": "Inject ke FreeCAD", "color": "#22d3ee"},
    "freecad_socket_inject": {"label": "FreeCAD Live", "color": "#22d3ee"},
    "word_inject": {"label": "Inject ke Word", "color": "#2b579a"},
    "excel_inject": {"label": "Inject ke Excel", "color": "#217346"},
    "ppt_inject": {"label": "Inject ke PPT", "color": "#d04423"},
    "analyze_image": {"label": "Analisis gambar", "color": "#a855f7"},
}

# ── FloraPanel — Main QDockWidget ────────────────────────────
class FloraPanel(QtWidgets.QDockWidget):
    """Side panel Flora — mirip UI React, dark theme, chat interface."""

    def __init__(self, parent=None):
        super().__init__("🌸 Flora", parent)
        self.setObjectName("FloraPanel")
        self._messages = []
        self._current_blocks = []
        self._current_text = ""
        self._loading = False
        self._init_ui()
        self._init_api()
        self._init_signals()
        self._load_history()

    def _init_ui(self):
        """Bangun UI panel — header, chat area, input."""
        self.setFeatures(QtWidgets.QDockWidget.DockWidgetMovable |
                         QtWidgets.QDockWidget.DockWidgetClosable)
        self.setMinimumWidth(340)
        self.setMaximumWidth(520)
        self.setStyleSheet(f"""
            QDockWidget {{
                titlebar-close-icon: url(none);
                titlebar-normal-icon: url(none);
                font-family: {FONT_FAMILY};
                font-size: {FONT_SIZE}px;
                color: {COLOR_TEXT_PRIMARY};
                background-color: {COLOR_BG};
            }}
            QDockWidget::title {{
                background: {COLOR_SURFACE};
                padding: 8px 12px;
                border-bottom: 1px solid {COLOR_BORDER};
                font-size: 14px;
                font-weight: 600;
                color: {COLOR_TEXT_SECONDARY};
            }}
        """)

        # Main container
        container = QtWidgets.QWidget()
        main_layout = QtWidgets.QVBoxLayout()
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # ── Header ──────────────────────────────────────────
        header = self._build_header()
        main_layout.addWidget(header)

        # ── Chat area ───────────────────────────────────────
        self._chat_area = QtWidgets.QScrollArea()
        self._chat_area.setWidgetResizable(True)
        self._chat_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._chat_area.setStyleSheet(f"""
            QScrollArea {{
                border: none;
                background: {COLOR_BG};
            }}
        """)

        self._chat_container = QtWidgets.QWidget()
        self._chat_layout = QtWidgets.QVBoxLayout()
        self._chat_layout.setContentsMargins(14, 14, 14, 14)
        self._chat_layout.setSpacing(16)
        self._chat_layout.addStretch()
        self._chat_container.setLayout(self._chat_layout)
        self._chat_area.setWidget(self._chat_container)
        main_layout.addWidget(self._chat_area, 1)

        # ── Input area ──────────────────────────────────────
        input_area = self._build_input()
        main_layout.addWidget(input_area)

        container.setLayout(main_layout)
        self.setWidget(container)

    def _build_header(self):
        """Header dengan status + tombol action."""
        header = QtWidgets.QWidget()
        header.setFixedHeight(48)
        header.setStyleSheet(f"""
            background: {COLOR_SURFACE};
            border-bottom: 1px solid {COLOR_BORDER};
        """)

        layout = QtWidgets.QHBoxLayout()
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        # Logo + title
        title = QtWidgets.QLabel("🌸 Flora")
        title.setStyleSheet(f"""
            font-size: 15px;
            font-weight: 600;
            color: {COLOR_TEXT_SECONDARY};
            background: transparent;
            border: none;
        """)
        layout.addWidget(title)

        layout.addStretch()

        # Status indicator
        self._status_dot = QtWidgets.QLabel()
        self._status_dot.setFixedSize(8, 8)
        self._status_dot.setStyleSheet(f"""
            background-color: {COLOR_TOOL_RUNNING};
            border-radius: 4px;
        """)
        layout.addWidget(self._status_dot)

        self._status_label = QtWidgets.QLabel("Online")
        self._status_label.setStyleSheet(f"""
            font-size: 11px;
            color: {COLOR_TEXT_TERTIARY};
            background: transparent;
            border: none;
        """)
        layout.addWidget(self._status_label)

        # Separator
        sep = QtWidgets.QFrame()
        sep.setFrameShape(QtWidgets.QFrame.VLine)
        sep.setStyleSheet(f"background: {COLOR_BORDER};")
        sep.setFixedWidth(1)
        sep.setFixedHeight(20)
        layout.addWidget(sep)

        # Scene button
        scene_btn = QtWidgets.QPushButton("3D")
        scene_btn.setFixedSize(30, 30)
        scene_btn.setToolTip("Lihat scene FreeCAD")
        scene_btn.setStyleSheet(f"""
            QPushButton {{
                background: rgba(255,255,255,0.04);
                border: 1px solid {COLOR_BORDER};
                border-radius: 8px;
                font-size: 13px;
                color: {COLOR_TEXT_TERTIARY};
            }}
            QPushButton:hover {{
                background: rgba(255,255,255,0.08);
                color: {COLOR_TEXT_SECONDARY};
            }}
        """)
        scene_btn.clicked.connect(self._on_scene)
        layout.addWidget(scene_btn)

        # Ping button
        ping_btn = QtWidgets.QPushButton("⏎")
        ping_btn.setFixedSize(30, 30)
        ping_btn.setToolTip("Ping backend")
        ping_btn.setStyleSheet(f"""
            QPushButton {{
                background: rgba(255,255,255,0.04);
                border: 1px solid {COLOR_BORDER};
                border-radius: 8px;
                font-size: 13px;
                color: {COLOR_TEXT_TERTIARY};
            }}
            QPushButton:hover {{
                background: rgba(255,255,255,0.08);
                color: {COLOR_TEXT_SECONDARY};
            }}
        """)
        ping_btn.clicked.connect(self._on_ping)
        layout.addWidget(ping_btn)

        header.setLayout(layout)
        return header

    def _build_input(self):
        """Input area — mirip InputArea.tsx"""
        container = QtWidgets.QWidget()
        container.setStyleSheet(f"""
            background: {COLOR_BG};
            border-top: 1px solid {COLOR_BORDER};
        """)

        layout = QtWidgets.QVBoxLayout()
        layout.setContentsMargins(12, 10, 12, 12)
        layout.setSpacing(6)

        # Input row
        input_row = QtWidgets.QHBoxLayout()
        input_row.setSpacing(8)

        self._input_edit = QtWidgets.QTextEdit()
        self._input_edit.setPlaceholderText("Ketik pesan untuk Flora...")
        self._input_edit.setFixedHeight(44)
        self._input_edit.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._input_edit.setStyleSheet(f"""
            QTextEdit {{
                background: {COLOR_INPUT_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 12px;
                padding: 10px 14px;
                font-size: {FONT_SIZE}px;
                color: {COLOR_TEXT_PRIMARY};
                selection-background-color: rgba(129, 140, 248, 0.3);
            }}
            QTextEdit:focus {{
                border: 1px solid rgba(255,255,255,0.12);
                background: rgba(24, 24, 37, 0.9);
            }}
        """)
        self._input_edit.installEventFilter(self)
        input_row.addWidget(self._input_edit, 1)

        # Send button
        self._send_btn = QtWidgets.QPushButton("➤")
        self._send_btn.setFixedSize(40, 40)
        self._send_btn.setEnabled(False)
        self._send_btn.setStyleSheet(f"""
            QPushButton {{
                background: rgba(255,255,255,0.08);
                border: 1px solid {COLOR_BORDER};
                border-radius: 10px;
                font-size: 16px;
                color: {COLOR_TEXT_SECONDARY};
            }}
            QPushButton:hover {{
                background: rgba(255,255,255,0.12);
                color: {COLOR_TEXT_PRIMARY};
            }}
            QPushButton:disabled {{
                background: transparent;
                color: rgba(255,255,255,0.1);
                border: 1px solid transparent;
            }}
        """)
        self._send_btn.clicked.connect(self._on_send)
        input_row.addWidget(self._send_btn)

        layout.addLayout(input_row)

        # Hint text
        hint = QtWidgets.QLabel("Ctrl+Enter kirim · /scene /help /ping")
        hint.setAlignment(Qt.AlignCenter)
        hint.setStyleSheet(f"""
            font-size: 11px;
            font-family: {FONT_MONO};
            color: rgba(255,255,255,0.12);
            background: transparent;
            border: none;
        """)
        layout.addWidget(hint)

        container.setLayout(layout)
        return container

    def _init_api(self):
        self._api = APIClient(self)

    def _init_signals(self):
        self._api.message_token.connect(self._on_token)
        self._api.tool_started.connect(self._on_tool_start)
        self._api.tool_ended.connect(self._on_tool_end)
        self._api.stream_done.connect(self._on_done)
        self._api.stream_error.connect(self._on_error)
        self._input_edit.textChanged.connect(self._on_text_changed)

    def _load_history(self):
        """Load riwayat chat dari backend."""
        try:
            import urllib.request
            req = urllib.request.Request(f"{API_URL}/api/memory")
            resp = urllib.request.urlopen(req, timeout=5)
            data = json.loads(resp.read().decode())
            messages = data.get("messages", [])
            for msg in messages:
                role = msg.get("role", "assistant")
                content = msg.get("content", "")
                blocks = msg.get("blocks", [])
                if not blocks and content:
                    blocks = [{"type": "text", "text": content}]
                self._add_bubble(role, blocks)
        except Exception as e:
            App.Console.PrintLog(f"🌸 Panel: Gagal load history - {e}\n")

    # ── Event handlers ──────────────────────────────────────
    def eventFilter(self, obj, event):
        if obj == self._input_edit and event.type() == QtCore.QEvent.KeyPress:
            if event.key() == Qt.Key_Return and (event.modifiers() & Qt.ControlModifier):
                self._on_send()
                return True
            elif event.key() == Qt.Key_Return and not (event.modifiers() & Qt.ControlModifier):
                # Enter = new line di QTextEdit
                return False
        return super().eventFilter(obj, event)

    def _on_text_changed(self):
        text = self._input_edit.toPlainText().strip()
        self._send_btn.setEnabled(len(text) > 0 and not self._loading)

    def _on_send(self):
        text = self._input_edit.toPlainText().strip()
        if not text or self._loading:
            return

        # Handle special commands
        if text.startswith("/"):
            self._handle_command(text)
            return

        # User bubble
        self._add_user_bubble(text)
        self._input_edit.clear()
        self._loading = True
        self._send_btn.setEnabled(False)
        self._current_blocks = []
        self._current_text = ""

        # Prepare empty assistant bubble
        self._current_blocks = []
        self._add_assistant_bubble()

        # Kirim ke backend
        self._api.send_message(text)

    def _handle_command(self, cmd):
        self._input_edit.clear()
        cmd = cmd.lower().strip()

        if cmd == "/scene" or cmd == "/3d":
            self._exec_freecad("flora_scene()")
        elif cmd == "/ping":
            self._on_ping()
        elif cmd == "/help":
            help_text = """🌸 <b>Flora Panel — Perintah</b><br><br>
<b>/scene</b> — Lihat objek di scene FreeCAD<br>
<b>/ping</b> — Test koneksi ke backend<br>
<b>/clear</b> — Bersihkan chat<br>
<b>/help</b> — Tampilkan help ini<br><br>
Atau ketik pertanyaan biasa untuk chat dengan Flora AI."""
            self._add_system_bubble(help_text)
        elif cmd == "/clear":
            self._clear_chat()
        else:
            self._add_system_bubble(f"Perintah tidak dikenal: {cmd}")

    def _on_ping(self):
        try:
            import urllib.request
            req = urllib.request.Request(f"{API_URL}/api/health")
            resp = urllib.request.urlopen(req, timeout=3)
            data = json.loads(resp.read().decode())
            status = "✅" if data.get("ok") else "❌"
            self._add_system_bubble(
                f"{status} Backend: <b>{data.get('provider', 'unknown')}</b><br>"
                f"📁 Project: {data.get('projectPath', 'unknown')}"
            )
        except Exception as e:
            self._add_system_bubble(f"❌ Backend tidak merespon: {e}")

    def _on_scene(self):
        """Tampilkan info scene FreeCAD."""
        self._exec_freecad("flora_scene()")

    def _exec_freecad(self, code):
        """Jalankan kode Python di FreeCAD console."""
        try:
            exec(code)
        except Exception as e:
            self._add_system_bubble(f"⚠️ Error: {e}")

    # ── SSE handlers ────────────────────────────────────
    def _on_token(self, text):
        self._current_text += text
        # Update last block text
        if self._current_blocks and self._current_blocks[-1]["type"] == "text":
            self._current_blocks[-1]["text"] = self._current_text
        else:
            self._current_blocks.append({"type": "text", "text": self._current_text})
        # Batched live update — debounce ke 30ms biar gak overload UI
        self._schedule_live_update()

    def _on_tool_start(self, name, args):
        block = {"type": "tool", "name": name, "status": "running", "args": args, "preview": ""}
        self._current_blocks.append(block)
        # Immediate update untuk tool card baru
        self._flush_live_update()

    def _on_tool_end(self, name, preview):
        for b in reversed(self._current_blocks):
            if b["type"] == "tool" and b["name"] == name and b["status"] == "running":
                b["status"] = "done"
                b["preview"] = preview
                break
        self._flush_live_update()

    def _on_done(self):
        self._loading = False
        self._send_btn.setEnabled(True)
        # Final flush
        self._flush_live_update()
        self._current_blocks = []
        self._current_text = ""

    def _on_error(self, err_msg):
        if self._current_blocks:
            self._current_blocks.append({
                "type": "text",
                "text": f"⚠️ Error: {err_msg}"
            })
            self._flush_live_update()
        else:
            self._add_system_bubble(f"⚠️ Error: {err_msg}")
        self._loading = False
        self._send_btn.setEnabled(True)

    _live_update_timer = None

    def _schedule_live_update(self):
        """Debounce live update — hanya update UI tiap 30ms."""
        if self._live_update_timer is not None:
            self._live_update_timer.stop()
        self._live_update_timer = QtCore.QTimer.singleShot(30, self._flush_live_update)

    def _flush_live_update(self):
        """Apply current blocks ke assistant bubble tanpa destroy/recreate."""
        count = self._chat_layout.count()
        if count < 2:
            return
        last_widget = self._chat_layout.itemAt(count - 2).widget()
        if last_widget and isinstance(last_widget, ChatBubble) and not last_widget._is_user:
            last_widget.live_update(self._current_blocks)
            self._scroll_to_bottom()

    # ── Chat bubble management ──────────────────────────
    def _add_user_bubble(self, text):
        blocks = [{"type": "text", "text": text}]
        self._messages.append({"role": "user", "blocks": blocks})
        self._add_bubble("user", blocks)

    def _add_assistant_bubble(self):
        blocks = []
        self._messages.append({"role": "assistant", "blocks": blocks})
        self._add_bubble("assistant", blocks)

    def _add_system_bubble(self, html):
        blocks = [{"type": "text", "text": html}]
        self._messages.append({"role": "assistant", "blocks": blocks})
        self._add_bubble("assistant", blocks)

    def _add_bubble(self, role, blocks):
        bubble = ChatBubble(role, blocks=blocks)
        # Insert before stretch
        count = self._chat_layout.count()
        if count > 0:
            self._chat_layout.insertWidget(count - 1, bubble)
        else:
            self._chat_layout.addWidget(bubble)
        self._scroll_to_bottom()

    def _update_last_bubble(self):
        """Update widget terakhir dengan blocks terkini."""
        count = self._chat_layout.count()
        if count < 2:
            return
        last_widget = self._chat_layout.itemAt(count - 2).widget()
        if last_widget and isinstance(last_widget, ChatBubble):
            last_widget._blocks = self._current_blocks
            # Rebuild UI
            self._chat_layout.removeWidget(last_widget)
            last_widget.deleteLater()
            self._add_bubble("assistant", self._current_blocks)

    def _clear_chat(self):
        """Bersihkan semua chat."""
        while self._chat_layout.count() > 1:
            item = self._chat_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._messages = []
        self._current_blocks = []
        self._current_text = ""

    def _scroll_to_bottom(self):
        QtCore.QTimer.singleShot(50, lambda: self._chat_area.verticalScrollBar().setValue(
            self._chat_area.verticalScrollBar().maximum()
        ))

    def closeEvent(self, event):
        """Sembunyikan panel, bukan tutup."""
        self.hide()
        event.ignore()

# ── Factory function ─────────────────────────────────────────
def create_flora_panel():
    """Buat dan tampilkan Flora Panel."""
    global _panel_instance
    if _panel_instance is not None:
        try:
            _panel_instance.show()
            _panel_instance.raise_()
            return _panel_instance
        except:
            _panel_instance = None

    try:
        mw = Gui.getMainWindow()
        panel = FloraPanel(mw)
        mw.addDockWidget(Qt.RightDockWidgetArea, panel)
        panel.show()
        _panel_instance = panel
        App.Console.PrintLog("🌸 Flora Panel: Created and shown\n")
        return panel
    except Exception as e:
        App.Console.PrintLog(f"🌸 Flora Panel: Gagal buat panel - {e}\n")
        return None

def get_panel():
    """Dapatkan instance panel yang ada."""
    global _panel_instance
    return _panel_instance

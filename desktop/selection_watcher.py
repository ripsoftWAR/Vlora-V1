"""
selection_watcher.py — Inline Selection Watcher for FLORA (Windows)

Cara kerja:
  1. Global hotkey: Ctrl+Shift+F → ambil teks yang sedang diblok
  2. Atau polling clipboard (otomatis) — deteksi perubahan teks
  3. Munculkan floating badge "❓ Tanya FLORA" di pojok kanan atas
  4. Klik badge → kirim teks selection ke backend FLORA via HTTP
  5. Backend forward ke frontend via SSE → muncul sebagai chip di input

Cara pakai:
  python desktop/selection_watcher.py [--port 5000]

  Hotkey: Ctrl+Shift+F — ambil teks yang diblok & tampilkan badge
  Atau: blok teks → Ctrl+C → badge otomatis muncul

Requirements:
  - Python 3.8+
  - Windows (win32clipboard)
  - tkinter (built-in)
  - requests (pip install requests)
"""

import sys
import os
import json
import time
import threading
import tkinter as tk
from tkinter import ttk
import requests
import argparse

# ── Windows-only imports ────────────────────────────────────────
try:
    import win32clipboard
    import win32con
    import win32api
    import win32gui
    import win32process
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

# ── Config ──────────────────────────────────────────────────────
POLL_INTERVAL = 0.3  # detik — cek clipboard tiap 300ms
BACKEND_URL = 'http://localhost:5000'
BADGE_WIDTH = 160
BADGE_HEIGHT = 42
FADE_DURATION = 0.15  # detik

# ── State ───────────────────────────────────────────────────────
_last_clipboard = ''
_selection_text = ''
_badge_window = None
_root = None
_fade_after_id = None
_hotkey_thread = None


def get_backend_url():
    """Dapatkan URL backend dari env atau default."""
    return os.environ.get('FLORA_BACKEND_URL', BACKEND_URL)


def get_clipboard_text():
    """Baca teks dari clipboard Windows menggunakan win32clipboard.
    
    Lebih reliable daripada pyperclip karena langsung panggil API Windows.
    """
    if not HAS_WIN32:
        return ''
    
    try:
        win32clipboard.OpenClipboard()
        try:
            # Coba dapatkan teks dalam format CF_UNICODETEXT
            if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
                data = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
                return data
            # Fallback ke CF_TEXT
            elif win32clipboard.IsClipboardFormatAvailable(win32con.CF_TEXT):
                data = win32clipboard.GetClipboardData(win32con.CF_TEXT)
                if isinstance(data, bytes):
                    return data.decode('utf-8', errors='replace')
                return str(data)
        finally:
            win32clipboard.CloseClipboard()
    except Exception as e:
        # Kadang error karena clipboard diakses aplikasi lain
        return ''
    
    return ''


def send_selection_to_backend(text: str):
    """Kirim teks selection ke backend FLORA via HTTP POST.
    
    Backend akan forward ke frontend via SSE event 'inline_selection'.
    """
    url = f"{get_backend_url()}/api/inline-selection"
    try:
        resp = requests.post(
            url,
            json={"text": text},
            timeout=3,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code == 200:
            return True
        else:
            print(f"[SelectionWatcher] Backend error: {resp.status_code}", file=sys.stderr)
            return False
    except requests.ConnectionError:
        # Backend belum jalan — skip, gak usah spam error
        return False
    except Exception as e:
        print(f"[SelectionWatcher] Error: {e}", file=sys.stderr)
        return False


def create_badge(text: str):
    """Buat floating badge Tkinter — muncul di pojok kanan atas.
    
    Badge berisi:
      - Icon "❓"
      - Teks "Tanya FLORA"
      - Tooltip: potongan teks yang diblok
    """
    global _badge_window, _fade_after_id

    # Cancel fade-out yang sebelumnya
    if _fade_after_id:
        _root.after_cancel(_fade_after_id)
        _fade_after_id = None

    # Destroy badge lama kalau ada
    if _badge_window and _badge_window.winfo_exists():
        _badge_window.destroy()

    # Buat window baru — tanpa border, always on top
    _badge_window = tk.Toplevel(_root)
    _badge_window.overrideredirect(True)  # tanpa title bar
    _badge_window.attributes('-topmost', True)
    _badge_window.attributes('-alpha', 0.95)

    # Posisi: pojok kanan atas, sedikit dari tepi
    screen_width = _root.winfo_screenwidth()
    screen_height = _root.winfo_screenheight()
    x = screen_width - BADGE_WIDTH - 24
    y = 80  # sedikit dari atas (biar gak nutup tombol close browser)
    _badge_window.geometry(f"{BADGE_WIDTH}x{BADGE_HEIGHT}+{x}+{y}")

    # ── Frame utama ─────────────────────────────────────────────
    frame = tk.Frame(
        _badge_window,
        bg='#2a2a2a',
        highlightbackground='#444444',
        highlightthickness=1,
        cursor='hand2',
    )
    frame.pack(fill='both', expand=True)

    # ── Icon + Teks ─────────────────────────────────────────────
    icon_label = tk.Label(
        frame,
        text='❓',
        font=('Segoe UI', 14),
        bg='#2a2a2a',
        fg='#ededed',
    )
    icon_label.pack(side='left', padx=(10, 4), pady=0)

    text_label = tk.Label(
        frame,
        text='Tanya FLORA',
        font=('Segoe UI', 12, 'bold'),
        bg='#2a2a2a',
        fg='#ededed',
        anchor='w',
    )
    text_label.pack(side='left', fill='both', expand=True, padx=(0, 10), pady=0)

    # ── Tooltip — potongan teks yang diblok ─────────────────────
    preview = text[:60] + ('...' if len(text) > 60 else '')
    tooltip_text = f"Teks: \"{preview}\"\nKlik untuk kirim ke FLORA"

    def show_tooltip(event):
        tooltip = tk.Toplevel(_badge_window)
        tooltip.overrideredirect(True)
        tooltip.attributes('-topmost', True)
        tooltip.attributes('-alpha', 0.9)
        
        label = tk.Label(
            tooltip,
            text=tooltip_text,
            font=('Segoe UI', 10),
            bg='#1a1a1a',
            fg='#ededed',
            padx=10,
            pady=6,
            wraplength=250,
            justify='left',
        )
        label.pack()
        
        # Posisi tooltip di bawah badge
        tx = _badge_window.winfo_x()
        ty = _badge_window.winfo_y() + BADGE_HEIGHT + 4
        tooltip.geometry(f"+{tx}+{ty}")
        
        # Simpan referensi
        tooltip._parent_ref = _badge_window
        _badge_window.tooltip = tooltip

    def hide_tooltip(event):
        if hasattr(_badge_window, 'tooltip') and _badge_window.tooltip:
            try:
                _badge_window.tooltip.destroy()
            except:
                pass
            _badge_window.tooltip = None

    # ── Hover effects ───────────────────────────────────────────
    def on_enter(event):
        frame.configure(bg='#333333')
        icon_label.configure(bg='#333333')
        text_label.configure(bg='#333333')
        _badge_window.configure(bg='#333333')

    def on_leave(event):
        frame.configure(bg='#2a2a2a')
        icon_label.configure(bg='#2a2a2a')
        text_label.configure(bg='#2a2a2a')
        _badge_window.configure(bg='#2a2a2a')

    # ── Click handler ───────────────────────────────────────────
    def on_click(event):
        # Kirim teks selection ke backend
        send_selection_to_backend(text)
        # Animasi klik — flash
        frame.configure(bg='#8b5cf6')
        icon_label.configure(bg='#8b5cf6')
        text_label.configure(bg='#8b5cf6')
        _badge_window.after(200, lambda: destroy_badge())

    def destroy_badge():
        if _badge_window and _badge_window.winfo_exists():
            _badge_window.destroy()
        global _badge_window
        _badge_window = None

    # Bind events ke semua widget
    for widget in [frame, icon_label, text_label, _badge_window]:
        widget.bind('<Enter>', on_enter)
        widget.bind('<Leave>', on_leave)
        widget.bind('<Button-1>', on_click)
        widget.bind('<Enter>', show_tooltip, add='+')
        widget.bind('<Leave>', hide_tooltip, add='+')

    # ── Auto-fade setelah 8 detik ──────────────────────────────
    _fade_after_id = _root.after(8000, fade_out_badge)


def fade_out_badge():
    """Fade out badge perlahan lalu destroy."""
    global _badge_window, _fade_after_id
    _fade_after_id = None

    if not _badge_window or not _badge_window.winfo_exists():
        return

    def fade(alpha):
        if not _badge_window or not _badge_window.winfo_exists():
            return
        if alpha <= 0:
            _badge_window.destroy()
            global _badge_window
            _badge_window = None
            return
        try:
            _badge_window.attributes('-alpha', alpha)
        except:
            pass
        _root.after(30, lambda: fade(alpha - 0.05))

    fade(0.95)


def poll_clipboard():
    """Loop polling clipboard — deteksi perubahan teks.
    
    Logika:
      1. Baca clipboard via win32clipboard (lebih reliable)
      2. Kalau beda dari _last_clipboard DAN bukan empty → ada selection baru
      3. Tampilkan badge
      4. Update _last_clipboard
    
    Catatan: Di Windows, user harus Ctrl+C dulu untuk mengisi clipboard.
    Tapi ini cara PALING universal — gak perlu install library tambahan.
    """
    global _last_clipboard, _selection_text

    try:
        current = get_clipboard_text()
    except:
        _root.after(int(POLL_INTERVAL * 1000), poll_clipboard)
        return

    # Filter: hanya proses kalau:
    #   - Berubah dari sebelumnya
    #   - Tidak kosong
    #   - Bukan hasil copy dari FLORA sendiri (hindari loop)
    if (current and
        current != _last_clipboard and
        len(current.strip()) > 0 and
        len(current) < 5000 and  # batasi panjang
        not current.startswith('[FLORA_INTERNAL]')):  # hindari loop
        
        _selection_text = current
        _last_clipboard = current
        
        # Tampilkan badge di thread utama Tkinter
        _root.after(0, lambda: create_badge(current))

    # Lanjut polling
    _root.after(int(POLL_INTERVAL * 1000), poll_clipboard)


def start_tkinter():
    """Start Tkinter root window — hidden, hanya untuk badge."""
    global _root
    
    _root = tk.Tk()
    _root.withdraw()  # Sembunyikan window utama
    _root.title('FLORA Selection Watcher')
    
    # Set icon kalau ada
    try:
        icon_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', 'favicon.svg')
        if os.path.exists(icon_path):
            pass
    except:
        pass

    # Mulai polling clipboard
    _root.after(500, poll_clipboard)  # delay 500ms biar stabil dulu

    print("🧊 FLORA Selection Watcher AKTIF!", file=sys.stderr)
    print(f"   Polling clipboard setiap {POLL_INTERVAL}s", file=sys.stderr)
    print(f"   Backend: {get_backend_url()}", file=sys.stderr)
    print(f"   Badge: pojok kanan atas", file=sys.stderr)
    print(f"   Cara pakai: blok teks → Ctrl+C → badge muncul", file=sys.stderr)
    print(f"   Tutup: Ctrl+C di terminal ini", file=sys.stderr)
    print(file=sys.stderr)

    _root.mainloop()


def main():
    parser = argparse.ArgumentParser(description='FLORA Inline Selection Watcher')
    parser.add_argument('--port', type=int, default=5000, help='Backend port (default: 5000)')
    parser.add_argument('--poll', type=float, default=POLL_INTERVAL, help='Poll interval detik (default: 0.3)')
    args = parser.parse_args()

    global POLL_INTERVAL, BACKEND_URL
    POLL_INTERVAL = args.poll
    BACKEND_URL = f'http://localhost:{args.port}'

    # Cek dependencies
    if not HAS_WIN32:
        print("❌ win32clipboard tidak tersedia. Jalankan:", file=sys.stderr)
        print("   pip install pywin32", file=sys.stderr)
        sys.exit(1)

    try:
        import requests
    except ImportError:
        print("❌ requests tidak terinstall. Jalankan:", file=sys.stderr)
        print("   pip install requests", file=sys.stderr)
        sys.exit(1)

    start_tkinter()


if __name__ == '__main__':
    main()

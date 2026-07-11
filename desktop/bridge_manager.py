"""
bridge_manager.py — Central manager untuk semua Office bridges.

Menangani:
  1. Spawning bridge yang benar sesuai app (word/excel/powerpoint)
  2. Routing command ke bridge yang sesuai
  3. Auto-start bridge kalau belum running
  4. Connection pooling (reuse bridge yang sudah ada)

CLI usage:
  python desktop/bridge_manager.py word [--debug]
  python desktop/bridge_manager.py excel [--debug]
  python desktop/bridge_manager.py powerpoint [--debug]
  python desktop/bridge_manager.py list          -- cek ketersediaan
  python desktop/bridge_manager.py doctor        -- diagnose
"""

import sys
import os
import subprocess
import json
import traceback


class BridgeManager:
    """Manager untuk semua Office bridges."""

    BRIDGES = {
        "word": {
            "module": "desktop.word_bridge",
            "class": "WordBridge",
            "app_name": "Word.Application",
            "description": "Microsoft Word — dokumen & penulisan",
            "extensions": [".docx", ".doc", ".dotx"],
        },
        "excel": {
            "module": "desktop.excel_bridge",
            "class": "ExcelBridge",
            "app_name": "Excel.Application",
            "description": "Microsoft Excel — spreadsheet & data",
            "extensions": [".xlsx", ".xls", ".xlsm", ".csv"],
        },
        "powerpoint": {
            "module": "desktop.powerpoint_bridge",
            "class": "PowerPointBridge",
            "app_name": "PowerPoint.Application",
            "description": "Microsoft PowerPoint — presentasi & slide",
            "extensions": [".pptx", ".ppt", ".ppsx"],
        },
    }

    def __init__(self):
        self.processes = {}  # app -> subprocess handle
        self._check_platform()

    def _check_platform(self):
        """Cek apakah Windows."""
        if sys.platform != 'win32' and sys.platform != 'win64':
            print(
                "⚠️  Peringatan: Platform saat ini bukan Windows.\n"
                "   COM Automation hanya berfungsi di Windows dengan Microsoft Office.\n"
                "   Kode tetap bisa di-load untuk testing, tapi tidak bisa connect ke Office.\n",
                file=sys.stderr
            )

    def list_available(self) -> list:
        """Daftar semua bridge yang tersedia."""
        result = []
        for name, info in self.BRIDGES.items():
            result.append({
                "name": name,
                "app": info["app_name"],
                "description": info["description"],
                "extensions": info["extensions"],
            })
        return result

    def doctor(self) -> dict:
        """Diagnosa ketersediaan Office di sistem ini."""
        report = {
            "platform": sys.platform,
            "is_windows": sys.platform in ('win32', 'win64'),
            "python_version": sys.version,
            "pywin32_available": False,
            "office_available": {},
            "errors": [],
        }

        # Cek pywin32
        try:
            import win32com.client
            report["pywin32_available"] = True
        except ImportError:
            report["errors"].append("pywin32 tidak terinstall. Jalankan: pip install pywin32")

        # Cek Office apps
        if report["pywin32_available"]:
            for name, info in self.BRIDGES.items():
                try:
                    app = win32com.client.GetActiveObject(info["app_name"])
                    app.Visible  # test
                    report["office_available"][name] = {
                        "running": True,
                        "ok": True,
                    }
                except Exception as e:
                    try:
                        app = win32com.client.Dispatch(info["app_name"])
                        report["office_available"][name] = {
                            "running": False,
                            "can_launch": True,
                            "ok": True,
                        }
                        app.Quit()
                    except Exception as e2:
                        report["office_available"][name] = {
                            "running": False,
                            "can_launch": False,
                            "ok": False,
                            "error": str(e2),
                        }
                        report["errors"].append(
                            f"{info['app_name']}: {e2}"
                        )

        return report

    def start_bridge(self, app: str, debug: bool = False) -> dict:
        """Start bridge process untuk app tertentu via stdin/stdout.

        Returns:
            dict dengan status start
        """
        if app not in self.BRIDGES:
            raise ValueError(
                f"Bridge '{app}' tidak dikenal. "
                f"Tersedia: {', '.join(self.BRIDGES.keys())}"
            )

        if app in self.processes and self.processes[app].poll() is None:
            # Sudah running
            return {"status": "already_running", "app": app}

        bridge_info = self.BRIDGES[app]
        cmd = [sys.executable, "-m", bridge_info["module"]]
        if debug:
            cmd.append("--debug")

        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # line buffered
            )
            self.processes[app] = proc

            # Baca response pertama (ready signal)
            ready_line = proc.stdout.readline()
            ready = json.loads(ready_line)

            return {
                "status": "started",
                "app": app,
                "pid": proc.pid,
                "ready": ready,
            }
        except Exception as e:
            raise RuntimeError(
                f"Gagal start bridge '{app}': {e}\n"
                f"Command: {' '.join(cmd)}"
            )

    def send_command(self, app: str, command: dict) -> dict:
        """Kirim command ke bridge yang sedang running, terima response.

        Args:
            app: 'word', 'excel', atau 'powerpoint'
            command: dict dengan action + params

        Returns:
            dict response dari bridge
        """
        if app not in self.processes:
            raise ConnectionError(
                f"Bridge '{app}' belum di-start. Panggil start_bridge('{app}') dulu."
            )

        proc = self.processes[app]
        if proc.poll() is not None:
            raise ConnectionError(
                f"Bridge '{app}' sudah mati (exit code: {proc.returncode}). Start ulang."
            )

        # Kirim command (satu baris JSON)
        cmd_str = json.dumps(command, ensure_ascii=False) + "\n"
        proc.stdin.write(cmd_str)
        proc.stdin.flush()

        # Baca response (satu baris JSON)
        response_line = proc.stdout.readline()
        if not response_line:
            # Cek stderr untuk error
            stderr = proc.stderr.read()
            raise RuntimeError(
                f"Bridge '{app}' tidak memberikan response. stderr:\n{stderr}"
            )

        try:
            return json.loads(response_line.strip())
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Invalid JSON response: {e}",
                "raw": response_line.strip(),
            }

    def stop_bridge(self, app: str):
        """Stop bridge dengan mengirim command 'exit'."""
        if app not in self.processes:
            return

        proc = self.processes[app]
        if proc.poll() is None:
            try:
                proc.stdin.write('{"action": "exit"}\n')
                proc.stdin.flush()
                proc.wait(timeout=5)
            except Exception:
                proc.kill()

        del self.processes[app]

    def stop_all(self):
        """Stop semua bridges."""
        for app in list(self.processes.keys()):
            self.stop_bridge(app)

    def __del__(self):
        self.stop_all()


# ═══════════════════════════════════════════════════════════════
# 🚀 CLI
# ═══════════════════════════════════════════════════════════════

def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Vlora-V1 Desktop Bridge Manager — Office COM Automation"
    )
    parser.add_argument(
        "command",
        choices=["word", "excel", "powerpoint", "list", "doctor"],
        help="Bridge atau perintah"
    )
    parser.add_argument("--debug", action="store_true", help="Debug mode")

    args = parser.parse_args()

    if args.command == "list":
        manager = BridgeManager()
        bridges = manager.list_available()
        print("📋 Office Bridges tersedia:")
        for b in bridges:
            print(f"  • {b['name']} — {b['description']}")
            print(f"    App: {b['app']}, Ext: {', '.join(b['extensions'])}")
        return

    if args.command == "doctor":
        manager = BridgeManager()
        report = manager.doctor()
        print("🩺 Office Bridge Diagnosis")
        print(f"   Platform: {report['platform']}")
        print(f"   pywin32: {'✅' if report['pywin32_available'] else '❌'}")

        if report["office_available"]:
            print("\n   Aplikasi Office:")
            for name, info in report["office_available"].items():
                status = "✅" if info["ok"] else "❌"
                running = " (running)" if info.get("running") else ""
                print(f"     {status} {name}{running}")

        if report["errors"]:
            print(f"\n   ⚠️  {len(report['errors'])} issue(s):")
            for err in report["errors"]:
                print(f"     • {err}")
        return

    # word / excel / powerpoint — run bridge
    manager = BridgeManager()
    bridge_info = manager.BRIDGES.get(args.command)

    # Import dan run bridge langsung
    import importlib
    module = importlib.import_module(bridge_info["module"])
    bridge_class = getattr(module, bridge_info["class"])

    bridge = bridge_class(debug=args.debug)
    try:
        print(f"🚀 Starting {bridge_info['app_name']} bridge...", file=sys.stderr)
        bridge.connect()
        bridge.run_forever()
    except KeyboardInterrupt:
        print("\n👋 Bridge stopped.", file=sys.stderr)
    except Exception as e:
        print(f"❌ Fatal: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
    finally:
        bridge.disconnect()


if __name__ == "__main__":
    main()

"""
freecad_send.py — Kirim command ke FreeCAD live socket
Pakai: python freecad_send.py <action> [json_args]
"""
import socket, json, sys, time

HOST = "127.0.0.1"
PORT = 9998

def send(cmd, timeout=15):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((HOST, PORT))
    
    payload = json.dumps(cmd) + '\n'
    s.sendall(payload.encode())
    
    # Baca response dengan loop
    data = b""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
            # Cek apakah sudah complete JSON
            try:
                decoded = data.decode().strip()
                if decoded:
                    json.loads(decoded)
                    s.close()
                    return json.loads(decoded)
            except json.JSONDecodeError:
                continue
        except socket.timeout:
            break
        except BlockingIOError:
            time.sleep(0.1)
            continue
    
    s.close()
    if data:
        try:
            return json.loads(data.decode().strip())
        except:
            return {"raw": data.decode()[:500]}
    return {"error": "No response"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Pakai: python freecad_send.py <action> [key=val ...]")
        sys.exit(1)
    
    action = sys.argv[1]
    cmd = {"action": action}
    
    for arg in sys.argv[2:]:
        if "=" in arg:
            k, v = arg.split("=", 1)
            cmd[k] = v
    
    # Untuk code, baca dari file jika parameter code=@filepath
    if cmd.get("code", "").startswith("@"):
        fpath = cmd["code"][1:]
        with open(fpath, "r", encoding="utf-8") as f:
            cmd["code"] = f.read()
    # Untuk code, baca dari stdin jika parameter code=-
    elif cmd.get("code") == "-":
        cmd["code"] = sys.stdin.read()
    
    result = send(cmd)
    print(json.dumps(result, indent=2, ensure_ascii=False))

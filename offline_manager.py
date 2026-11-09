#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ระบบจัดการงวดงานย้อนหลังออฟไลน์บน PC (Offline Backup Manager) v3.0
- ทำงานแบบ Standalone 100% ด้วย Python Standard Library (ไม่ต้องติดตั้งแพ็กเกจภายนอก)
- จัดการไฟล์สำรอง (.zip และโฟลเดอร์) ในไดเรกทอรี pc_backups/
- รองรับการเปิดดู แก้ไขงานย้อนหลัง เพิ่ม/ลบรูป และออกใบสรุปรายงานใหม่บน PC โดยไม่กระทบเว็บออนไลน์
"""

import os
import sys
import json
import zipfile
import shutil
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
import webbrowser
import threading
import time

PORT = 8765
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUPS_DIR = os.path.join(BASE_DIR, "pc_backups")
os.makedirs(BACKUPS_DIR, exist_ok=True)

# สถานะงวดงานที่กำลังเปิดอยู่บน PC
CURRENT_STATE = {
    "active_folder": None,       # ชื่อโฟลเดอร์ใน pc_backups
    "folder_path": None,         # Absolute path
    "package_data": None         # ข้อมูล JSON ในหน่วยความจำ
}


def sanitize_filename(name, max_len=40):
    cleaned = "".join(c if (c.isalnum() or c in "._- ") else "_" for c in str(name))
    cleaned = cleaned.strip().replace(" ", "_")
    return cleaned[:max_len] or "backup"


def list_pc_backups():
    items = []
    if not os.path.exists(BACKUPS_DIR):
        return items
    for name in os.listdir(BACKUPS_DIR):
        full = os.path.join(BACKUPS_DIR, name)
        if os.path.isdir(full):
            json_file = os.path.join(full, "backup_data.json")
            has_data = os.path.isfile(json_file)
            img_dir = os.path.join(full, "images")
            img_count = len(os.listdir(img_dir)) if os.path.isdir(img_dir) else 0
            items.append({
                "type": "folder",
                "name": name,
                "path": full,
                "has_data": has_data,
                "images_count": img_count,
                "modified": os.path.getmtime(full)
            })
        elif name.lower().endswith(".zip"):
            items.append({
                "type": "zip",
                "name": name,
                "path": full,
                "size": os.path.getsize(full),
                "modified": os.path.getmtime(full)
            })
    items.sort(key=lambda x: x["modified"], reverse=True)
    return items


def extract_zip_to_folder(zip_path, folder_name=None):
    if not folder_name:
        base = os.path.splitext(os.path.basename(zip_path))[0]
        folder_name = sanitize_filename(base, 50)
    target_dir = os.path.join(BACKUPS_DIR, folder_name)
    os.makedirs(target_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(target_dir)

    # ตรวจสอบหาไฟล์ JSON หากอยู่ลึกหรือชื่ออื่น
    target_json = os.path.join(target_dir, "backup_data.json")
    if not os.path.isfile(target_json):
        for root, _, files in os.walk(target_dir):
            for f in files:
                if f.lower().endswith(".json"):
                    shutil.move(os.path.join(root, f), target_json)
                    break
            if os.path.isfile(target_json):
                break

    return target_dir, folder_name


def load_folder_backup(folder_name):
    target_dir = os.path.join(BACKUPS_DIR, folder_name)
    json_path = os.path.join(target_dir, "backup_data.json")
    if not os.path.isfile(json_path):
        raise FileNotFoundError(f"ไม่พบไฟล์ backup_data.json ในโฟลเดอร์ {folder_name}")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    CURRENT_STATE["active_folder"] = folder_name
    CURRENT_STATE["folder_path"] = target_dir
    CURRENT_STATE["package_data"] = data
    return data


def save_folder_backup(payload):
    folder_name = CURRENT_STATE.get("active_folder")
    if not folder_name:
        folder_name = sanitize_filename(payload.get("fileName") or "Backup_PC", 50)
        CURRENT_STATE["active_folder"] = folder_name
        CURRENT_STATE["folder_path"] = os.path.join(BACKUPS_DIR, folder_name)

    target_dir = CURRENT_STATE["folder_path"]
    os.makedirs(target_dir, exist_ok=True)
    images_dir = os.path.join(target_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    json_path = os.path.join(target_dir, "backup_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # อัปเดต CSV บันทึกประจำวัน
    raw_logs = payload.get("rawLogs") or []
    if raw_logs:
        csv_path = os.path.join(target_dir, "daily_logs.csv")
        headers = [
            "วันที่", "ไซต์งาน", "รายละเอียดงาน", "ผู้สั่งงาน",
            "ชื่อคนงาน", "ประเภทค่าแรง", "ค่าแรงรายวัน", "ชั่วโมงปกติ",
            "ชั่วโมง_OT", "ยอดเหมา", "ค่าแรงดิบ", "รวมสุทธิ(+20%)",
            "รหัสใบสั่งงาน(TaskID)", "GroupID"
        ]
        lines = [",".join(f'"{h}"' for h in headers)]
        for r in raw_logs:
            row = [
                str(r.get("Date") or r.get("work_date") or ""),
                str(r.get("Site") or r.get("site") or ""),
                str(r.get("JobDetail") or r.get("job_detail") or ""),
                str(r.get("RequestedBy") or r.get("requested_by") or ""),
                str(r.get("WorkerName") or r.get("worker_name") or ""),
                "เหมาจ่าย" if (r.get("WageType") or r.get("wage_type")) == "fixed" else "รายชั่วโมง",
                str(r.get("DailyWage") or r.get("daily_wage") or 0),
                str(r.get("Hours") or r.get("hours") or 0),
                str(r.get("OTHours") or r.get("ot_hours") or 0),
                str(r.get("FixedAmount") or r.get("fixed_amount") or 0),
                str(r.get("RawWage") or r.get("raw_wage") or 0),
                str(r.get("TotalWithMarkup") or r.get("total_with_markup") or 0),
                str(r.get("TaskId") or r.get("task_id") or ""),
                str(r.get("GroupID") or r.get("group_id") or "")
            ]
            lines.append(",".join(f'"{c.replace(chr(34), chr(34)+chr(34))}"' for c in row))
        with open(csv_path, "w", encoding="utf-8-sig") as f:
            f.write("\r\n".join(lines))

    CURRENT_STATE["package_data"] = payload
    return {"saved": True, "folder": folder_name, "path": target_dir}


def export_folder_to_zip(folder_name):
    target_dir = os.path.join(BACKUPS_DIR, folder_name)
    if not os.path.isdir(target_dir):
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์ {folder_name}")

    zip_filename = f"{folder_name}.zip"
    zip_path = os.path.join(BACKUPS_DIR, zip_filename)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(target_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, target_dir)
                z.write(abs_file, rel_file)

    return zip_path, zip_filename


class OfflineAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API ดึงสถานะโปรแกรมและรายชื่องวดงานบน PC
        if path == "/api/offline/info":
            backups = list_pc_backups()
            resp = {
                "is_offline_mode": True,
                "port": PORT,
                "backups_dir": BACKUPS_DIR,
                "active_folder": CURRENT_STATE.get("active_folder"),
                "has_active_data": CURRENT_STATE.get("package_data") is not None,
                "active_summary": {
                    "fileName": CURRENT_STATE.get("package_data", {}).get("fileName") if CURRENT_STATE.get("package_data") else None,
                    "startDate": CURRENT_STATE.get("package_data", {}).get("startDate") if CURRENT_STATE.get("package_data") else None,
                    "endDate": CURRENT_STATE.get("package_data", {}).get("endDate") if CURRENT_STATE.get("package_data") else None,
                    "logsCount": len(CURRENT_STATE.get("package_data", {}).get("logs", [])) if CURRENT_STATE.get("package_data") else 0
                },
                "backups": backups
            }
            self.send_json_response(resp)
            return

        # 2. API โหลดข้อมูลงวดงานเข้าโปรแกรม
        elif path == "/api/offline/load":
            folder = query.get("folder", [None])[0]
            zip_file = query.get("zip", [None])[0]
            try:
                if zip_file:
                    zip_path = os.path.join(BACKUPS_DIR, zip_file)
                    _, folder = extract_zip_to_folder(zip_path)
                if not folder:
                    # ถ้าไม่ได้ระบุ ให้หาโฟลเดอร์ล่าสุด
                    backups = list_pc_backups()
                    folders = [b["name"] for b in backups if b["type"] == "folder" and b["has_data"]]
                    if folders:
                        folder = folders[0]
                    else:
                        raise ValueError("ยังไม่มีโฟลเดอร์งวดงานใน pc_backups/")
                data = load_folder_backup(folder)
                self.send_json_response({"success": True, "folder": folder, "data": data})
            except Exception as e:
                self.send_json_response({"success": False, "error": str(e)}, status=400)
            return

        # 3. ให้บริการไฟล์รูปภาพออฟไลน์จากโฟลเดอร์ images/ ของงวดงานปัจจุบัน
        elif path.startswith("/offline_images/"):
            img_name = urllib.parse.unquote(path.replace("/offline_images/", ""))
            folder_path = CURRENT_STATE.get("folder_path")
            if folder_path:
                img_path = os.path.join(folder_path, "images", img_name)
                if os.path.isfile(img_path):
                    ext = os.path.splitext(img_path)[1].lower()
                    mime = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")
                    self.send_response(200)
                    self.send_header("Content-Type", mime)
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    with open(img_path, "rb") as f:
                        shutil.copyfileobj(f, self.wfile)
                    return
            self.send_error(404, "Image not found")
            return

        # ให้บริการไฟล์เว็บปกติ (index.html, assets, css, js ฯลฯ)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b""

        # 1. API บันทึกการแก้ไขลง PC
        if path == "/api/offline/save":
            try:
                payload = json.loads(body.decode("utf-8"))
                res = save_folder_backup(payload)
                self.send_json_response({"success": True, "result": res})
            except Exception as e:
                self.send_json_response({"success": False, "error": str(e)}, status=400)
            return

        # 2. API แตกไฟล์ ZIP
        elif path == "/api/offline/extract-zip":
            try:
                payload = json.loads(body.decode("utf-8"))
                zip_name = payload.get("zipName")
                zip_path = os.path.join(BACKUPS_DIR, zip_name)
                _, folder = extract_zip_to_folder(zip_path)
                data = load_folder_backup(folder)
                self.send_json_response({"success": True, "folder": folder, "data": data})
            except Exception as e:
                self.send_json_response({"success": False, "error": str(e)}, status=400)
            return

        # 3. API แพ็กโฟลเดอร์เป็น ZIP
        elif path == "/api/offline/export-zip":
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
                folder = payload.get("folder") or CURRENT_STATE.get("active_folder")
                if not folder:
                    raise ValueError("กรุณาระบุโฟลเดอร์งวดงานที่ต้องการส่งออก")
                zip_path, zip_name = export_folder_to_zip(folder)
                self.send_json_response({"success": True, "zipName": zip_name, "path": zip_path})
            except Exception as e:
                self.send_json_response({"success": False, "error": str(e)}, status=400)
            return

        self.send_error(404, "Not Found")

    def send_json_response(self, data, status=200):
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)


def open_browser():
    time.sleep(1.0)
    webbrowser.open(f"http://127.0.0.1:{PORT}/index.html")


def main():
    print("=" * 65)
    print("   ระบบจัดการงวดงานย้อนหลังออฟไลน์บน PC (Offline Mode)")
    print(f"   โฟลเดอร์เก็บข้อมูลสำรอง: {BACKUPS_DIR}")
    print(f"   กำลังเปิดระบบที่: http://127.0.0.1:{PORT}")
    print("=" * 65)

    server = HTTPServer(("127.0.0.1", PORT), OfflineAppHandler)
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดโปรแกรมจัดการออฟไลน์เรียบร้อยแล้ว")
        server.server_close()


if __name__ == "__main__":
    main()

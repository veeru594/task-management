import imaplib
import email
import os
import pandas as pd
from io import BytesIO
from datetime import datetime
from dotenv import load_dotenv
from dashboard_sets import DASHBOARD_MEMBERS
from db import get_db_connection

load_dotenv()

GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")
SENDER_FILTER = "veerandrak49@gmail.com"
SUBJECT_FILTER = "pending"
ATTACHMENT_EXTENSIONS = [".xlsx", ".xls"]

RAISED_BY_COL_OPTIONS = ["Employees ID", "Emp Id"]
ATTENDANCE_TYPE_COL = "Request Type"
LEAVE_TYPE_COL = "Leave Type"


def build_emp_map():
    emp_map = {}
    for member, employees in DASHBOARD_MEMBERS.items():
        for emp in employees:
            emp_map[emp["emp_id"]] = member
    return emp_map


def process_excel(file_bytes, filename):
    emp_map = build_emp_map()
    df = pd.read_excel(BytesIO(file_bytes))

    if ATTENDANCE_TYPE_COL in df.columns:
        sheet_type = "attendance"
        type_col = ATTENDANCE_TYPE_COL
    elif LEAVE_TYPE_COL in df.columns:
        sheet_type = "leave"
        type_col = LEAVE_TYPE_COL
    else:
        sheet_type = "unknown"
        type_col = None

    counts = {}
    breakdown = {}

    for _, row in df.iterrows():
        emp_id = None
        for col in RAISED_BY_COL_OPTIONS:
            val = str(row.get(col, "")).strip()
            if val and val != "nan":
                emp_id = val
                break
        if not emp_id:
            continue

        member = emp_map.get(emp_id)
        if not member:
            continue

        counts[member] = counts.get(member, 0) + 1

        if type_col and pd.notna(row.get(type_col)):
            req_type = str(row[type_col]).strip()
            breakdown.setdefault(member, {}).setdefault(sheet_type, {})
            breakdown[member][sheet_type][req_type] = (
                breakdown[member][sheet_type].get(req_type, 0) + 1
            )

    return counts, breakdown


def reset_and_upload(counts, breakdown):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("UPDATE dashboard_counts SET pending_count = 0, last_updated = NULL")
            cursor.execute("DELETE FROM pending_breakdown")
            cursor.execute("DELETE FROM uploaded_files")

            now = datetime.now()

            for member, count in counts.items():
                cursor.execute("""
                    INSERT INTO dashboard_counts (dashboard_member, pending_count, last_updated)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE pending_count = %s, last_updated = %s
                """, (member, count, now, count, now))

            for member, sheets in breakdown.items():
                for sheet_type, types in sheets.items():
                    for req_type, count in types.items():
                        cursor.execute("""
                            INSERT INTO pending_breakdown
                                (dashboard_member, sheet_type, request_type, count, last_updated)
                            VALUES (%s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE count = %s, last_updated = %s
                        """, (member, sheet_type, req_type, count, now, count, now))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def poll_emails():
    print(f"[{datetime.now()}] Checking emails...")

    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select("inbox")

    _, messages = mail.search(
        None,
        f'(UNSEEN FROM "{SENDER_FILTER}" SUBJECT "{SUBJECT_FILTER}")'
    )

    email_ids = messages[0].split()
    if not email_ids:
        print(f"[{datetime.now()}] No new emails found")
        mail.logout()
        return

    print(f"[{datetime.now()}] Found {len(email_ids)} new email(s)")

    all_counts = {}
    all_breakdown = {}

    for eid in email_ids:
        _, msg_data = mail.fetch(eid, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])

        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get("Content-Disposition") is None:
                continue

            filename = part.get_filename()
            if not filename:
                continue

            if not any(filename.lower().endswith(ext) for ext in ATTACHMENT_EXTENSIONS):
                continue

            print(f"[{datetime.now()}] Processing: {filename}")
            file_bytes = part.get_payload(decode=True)
            counts, breakdown = process_excel(file_bytes, filename)

            for member, count in counts.items():
                all_counts[member] = all_counts.get(member, 0) + count

            for member, sheets in breakdown.items():
                for sheet_type, types in sheets.items():
                    for req_type, count in types.items():
                        all_breakdown.setdefault(member, {}).setdefault(sheet_type, {})
                        all_breakdown[member][sheet_type][req_type] = (
                            all_breakdown[member][sheet_type].get(req_type, 0) + count
                        )

        mail.store(eid, "+FLAGS", "\\Seen")

    if all_counts:
        reset_and_upload(all_counts, all_breakdown)
        print(f"[{datetime.now()}] Dashboard updated successfully")
    else:
        print(f"[{datetime.now()}] No matching employee data found in attachments")

    mail.logout()


if __name__ == "__main__":
    poll_emails()

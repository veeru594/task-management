import os
import datetime
import pymysql
import pymysql.cursors
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from dashboard_sets import DASHBOARD_MEMBERS, DASHBOARD_PROGRAMS
from dotenv import load_dotenv

load_dotenv()

# --- DATABASE CONNECTION ---
def get_db_connection():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "hr_dashboard"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False
    )

def init_db():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Run schema.sql
            schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
            if os.path.exists(schema_path):
                with open(schema_path, "r") as f:
                    # MySQL can't execute multiple statements at once easily unless enabled
                    # So we split by semicolon
                    sql_commands = f.read().split(';')
                    for command in sql_commands:
                        if command.strip():
                            cur.execute(command)
            
            # Fix legacy double-space name: merge into the correct single-space entry if both exist
            cur.execute("SELECT COUNT(*) AS cnt FROM dashboard_counts WHERE dashboard_member = 'Paladi Rajani  Kanth'")
            if cur.fetchone()["cnt"]:
                cur.execute("SELECT COUNT(*) AS cnt FROM dashboard_counts WHERE dashboard_member = 'Paladi Rajani Kanth'")
                if cur.fetchone()["cnt"]:
                    cur.execute("""
                        UPDATE dashboard_counts dc1
                        JOIN dashboard_counts dc2 ON dc2.dashboard_member = 'Paladi Rajani  Kanth'
                        SET dc1.pending_count = dc1.pending_count + dc2.pending_count
                        WHERE dc1.dashboard_member = 'Paladi Rajani Kanth'
                    """)
                    cur.execute("DELETE FROM dashboard_counts WHERE dashboard_member = 'Paladi Rajani  Kanth'")
                else:
                    cur.execute("""
                        UPDATE dashboard_counts SET dashboard_member = 'Paladi Rajani Kanth'
                        WHERE dashboard_member = 'Paladi Rajani  Kanth'
                    """)

            # Initialize dashboard_counts with all members from DASHBOARD_MEMBERS
            for member in DASHBOARD_MEMBERS.keys():
                cur.execute("""
                    INSERT IGNORE INTO dashboard_counts (dashboard_member, pending_count, last_updated)
                    VALUES (%s, 0, NULL)
                """, (member,))
            
        conn.commit()
    finally:
        conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class UploadCounts(BaseModel):
    counts: dict
    file_name: str
    file_hash: str
    mode: str
    breakdown: dict = None

@app.get("/emp-map")
def get_emp_map():
    emp_map = {}
    for member, employees in DASHBOARD_MEMBERS.items():
        for emp in employees:
            emp_map[emp["emp_id"]] = member
            emp_map[emp["name"]] = member
    return emp_map

@app.get("/breakdown/{dashboard_member}")
def get_breakdown(dashboard_member: str):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sheet_type, request_type, count 
                FROM pending_breakdown 
                WHERE dashboard_member = %s
            """, (dashboard_member,))
            rows = cur.fetchall()
            
            result = {"attendance": {}, "leave": {}}
            for row in rows:
                sheet_type = row["sheet_type"]
                if sheet_type in result:
                    result[sheet_type][row["request_type"]] = row["count"]
            return result
    finally:
        conn.close()

@app.get("/dashboard")
def get_dashboard():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT dashboard_member, pending_count, last_updated FROM dashboard_counts ORDER BY dashboard_member")
            rows = cur.fetchall()
            result = []
            for row in rows:
                if row["dashboard_member"] not in VALID_MEMBERS:
                    continue
                if row["last_updated"]:
                    row["last_updated"] = row["last_updated"].isoformat()
                row["program"] = MEMBER_TO_PROGRAM.get(row["dashboard_member"], "Other")
                result.append(row)
            return result
    finally:
        conn.close()

VALID_MEMBERS = set(DASHBOARD_MEMBERS.keys())

MEMBER_TO_PROGRAM = {
    member: prog
    for prog, members in DASHBOARD_PROGRAMS.items()
    for member in members
}

@app.post("/upload-counts")
def upload_counts(data: UploadCounts):
    if data.mode not in ("add", "reset"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid mode")

    for member_name, count in data.counts.items():
        if member_name not in VALID_MEMBERS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown member: {member_name}")
        if not isinstance(count, int) or count < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid count for {member_name}")

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if data.mode == "reset":
                # Reset counts
                cur.execute("UPDATE dashboard_counts SET pending_count = 0, last_updated = NULL")
                # Clear breakdown
                cur.execute("DELETE FROM pending_breakdown")
                # Clear file hashes
                cur.execute("DELETE FROM uploaded_files")
            
            elif data.mode == "add":
                # Check for duplicate file
                cur.execute("SELECT 1 FROM uploaded_files WHERE file_hash = %s", (data.file_hash,))
                if cur.fetchone():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="This file has already been uploaded"
                    )
            
            now = datetime.datetime.now()
            
            # Update dashboard_counts
            for member_name, count in data.counts.items():
                if data.mode == "add":
                    cur.execute("""
                        UPDATE dashboard_counts 
                        SET pending_count = pending_count + %s, last_updated = %s 
                        WHERE dashboard_member = %s
                    """, (count, now, member_name))
                else:
                    cur.execute("""
                        UPDATE dashboard_counts 
                        SET pending_count = %s, last_updated = %s 
                        WHERE dashboard_member = %s
                    """, (count, now, member_name))
            
            # Update breakdown
            if data.breakdown:
                for member_name, b_data in data.breakdown.items():
                    sheet_type = b_data.get("sheet_type")
                    if sheet_type in ["attendance", "leave"]:
                        types = b_data.get("types", {})
                        for r_type, count in types.items():
                            if data.mode == "add":
                                cur.execute("""
                                    INSERT INTO pending_breakdown (dashboard_member, sheet_type, request_type, count, last_updated)
                                    VALUES (%s, %s, %s, %s, %s)
                                    ON DUPLICATE KEY UPDATE count = count + %s, last_updated = %s
                                """, (member_name, sheet_type, r_type, count, now, count, now))
                            else:
                                cur.execute("""
                                    INSERT INTO pending_breakdown (dashboard_member, sheet_type, request_type, count, last_updated)
                                    VALUES (%s, %s, %s, %s, %s)
                                    ON DUPLICATE KEY UPDATE count = %s, last_updated = %s
                                """, (member_name, sheet_type, r_type, count, now, count, now))

            # Record file hash
            cur.execute("INSERT INTO uploaded_files (file_hash, file_name, uploaded_at) VALUES (%s, %s, %s)", 
                        (data.file_hash, data.file_name, now))
            
            conn.commit()
            msg = "Dashboard reset and updated successfully" if data.mode == "reset" else "Dashboard updated successfully"
            return {"message": msg}
    except Exception as e:
        conn.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

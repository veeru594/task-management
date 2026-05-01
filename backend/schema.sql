-- Dashboard counts per member
CREATE TABLE IF NOT EXISTS dashboard_counts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dashboard_member VARCHAR(255) UNIQUE NOT NULL,
  pending_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP NULL DEFAULT NULL
);

-- Uploaded file hashes to block duplicates
CREATE TABLE IF NOT EXISTS uploaded_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_hash VARCHAR(255) UNIQUE NOT NULL,
  file_name VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Breakdown by request type per member
CREATE TABLE IF NOT EXISTS pending_breakdown (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dashboard_member VARCHAR(255) NOT NULL,
  sheet_type VARCHAR(50) NOT NULL,
  request_type VARCHAR(255) NOT NULL,
  count INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dashboard_member, sheet_type, request_type)
);

#!/usr/bin/env python3
"""
Log rotation script for server.log
Rotates logs daily and keeps the last 7 days
"""

import os
import gzip
import shutil
from datetime import datetime
from pathlib import Path

LOG_FILE = Path('/var/www/citymarkets.sa/city-market-app/server.log')
LOG_DIR = LOG_FILE.parent
MAX_DAYS = 7

def rotate_log():
    """Rotate the server.log file"""
    if not LOG_FILE.exists():
        print(f"Log file {LOG_FILE} does not exist")
        return
    
    # Check if log file has content
    if LOG_FILE.stat().st_size == 0:
        print("Log file is empty, skipping rotation")
        return
    
    # Create timestamped backup filename
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    rotated_name = f"server.log.{timestamp}"
    rotated_path = LOG_DIR / rotated_name
    
    # Rotate current log
    shutil.move(str(LOG_FILE), str(rotated_path))
    
    # Compress the rotated log
    with open(rotated_path, 'rb') as f_in:
        with gzip.open(f"{rotated_path}.gz", 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    
    # Remove uncompressed rotated log
    rotated_path.unlink()
    
    print(f"Rotated log to {rotated_path}.gz")
    
    # Clean up old logs
    cleanup_old_logs()

def cleanup_old_logs():
    """Remove logs older than MAX_DAYS"""
    pattern = "server.log.*.gz"
    cutoff = datetime.now().timestamp() - (MAX_DAYS * 86400)
    removed = 0
    
    for log_file in LOG_DIR.glob(pattern):
        if log_file.stat().st_mtime < cutoff:
            log_file.unlink()
            removed += 1
    
    if removed:
        print(f"Removed {removed} old log files")

if __name__ == '__main__':
    rotate_log()

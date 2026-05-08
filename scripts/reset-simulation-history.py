#!/usr/bin/env python3
"""Reset TuGou Catcher simulation history.

This clears discovered tokens, paper trades, alerts, snapshots, strategy logs,
and discovery logs while preserving configuration/provider lists and smart-money
wallet data.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "data" / "tugoucatcher.db"

TABLES_TO_CLEAR = [
    "trade_price_history",
    "trades",
    "portfolio_snapshots",
    "strategy_logs",
    "alerts",
    "discovery_logs",
    "token_snapshots",
    "tokens",
]

RESET_CONFIG = {
    "cash_sol": "1",
    "cash_ethereum": "0.1",
}


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys = ON")
        for table in TABLES_TO_CLEAR:
            cur.execute(f"DELETE FROM {table}")
        for key, value in RESET_CONFIG.items():
            cur.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()

        print(f"reset_db={DB_PATH}")
        print(f"reset_at_ms={int(time.time() * 1000)}")
        for table in TABLES_TO_CLEAR:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"{table}={cur.fetchone()[0]}")
        for key, value in RESET_CONFIG.items():
            print(f"{key}={value}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

from storage import create_backup, prune_backups


if __name__ == "__main__":
    create_backup("scheduled")
    prune_backups()
    # 매일 백업 뒤 오프사이트 미러링(설정 시). 실패해도 주 백업은 이미 완료 — 격리 호출.
    try:
        from offsite_backup import sync_offsite
        ok, msg = sync_offsite()
        print(msg)
    except Exception as exc:
        print(f"오프사이트 미러링 건너뜀: {exc}")

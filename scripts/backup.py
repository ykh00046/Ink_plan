from storage import create_backup, prune_backups


if __name__ == "__main__":
    create_backup("scheduled")
    prune_backups()

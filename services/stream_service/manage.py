#!/usr/bin/env python
import os
import sys
from pathlib import Path

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'stream_service.settings')
    
    # Ensure root services folder is on sys.path
    ROOT_DIR = Path(__file__).resolve().parent.parent.parent
    if str(ROOT_DIR) not in sys.path:
        sys.path.insert(0, str(ROOT_DIR))

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable?"
        ) from exc
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()

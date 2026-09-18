from django.db import models
import uuid
import re

class StreamConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200, default="International Retreat Live Stream")
    youtube_url = models.CharField(max_length=500, default="https://www.youtube.com/watch?v=jfKfPfyJRdk")
    youtube_video_id = models.CharField(max_length=50, default="jfKfPfyJRdk")
    is_live = models.BooleanField(default=True)
    # Admin-only, backend-driven switch — enabled once a broadcast has ended
    # so viewers can log in and watch the recording back through the same
    # protected player, just labeled "Playback" instead of "Live". Separate
    # from is_live so admins can turn the live broadcast off (showing the
    # offline banner to anyone NOT yet allowed to watch the recording) and
    # only flip this on when the recording is actually ready to share.
    is_playback_mode = models.BooleanField(default=False)
    # "Break glass" switch — when the normal app (login, Q&A, tab-lock,
    # protected player) is somehow broken or blocking legitimate viewers,
    # an admin can flip this to bypass ALL of it: every visitor instantly
    # sees a bare, loginless YouTube embed instead. Deliberately requires
    # the backend/DB to be reachable to toggle (it's just a flag here, same
    # as is_live/is_playback_mode) — this is a fallback for "our own app
    # logic is broken", not for "the backend itself is down".
    is_emergency_fallback = models.BooleanField(default=False)
    offline_image_url = models.TextField(
        default="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80"
    )
    offline_message = models.CharField(
        max_length=300,
        default="The live broadcast is currently offline. Please stay tuned for the next session."
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stream_configs'
        ordering = ['-updated_at']

    @staticmethod
    def extract_video_id(url_or_id: str) -> str:
        """Extracts standard 11-char YouTube Video ID from various URL formats."""
        if not url_or_id:
            return ""
        url_or_id = url_or_id.strip()
        if len(url_or_id) == 11 and not ('/' in url_or_id or '.' in url_or_id):
            return url_or_id

        patterns = [
            r'(?:v=|\/embed\/|\/watch\?v=|\/v\/|https:\/\/youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})',
            r'^([a-zA-Z0-9_-]{11})$'
        ]
        for pattern in patterns:
            match = re.search(pattern, url_or_id)
            if match:
                return match.group(1)
        # No known format matched — never return the raw input as-is, since
        # it could be arbitrarily long and this value gets stored in a
        # varchar(50) column (this previously caused a 500 error on save).
        return url_or_id[:50]

class Question(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('ANSWERED', 'Answered'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField()
    question_text = models.TextField(max_length=1000)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='APPROVED')
    upvotes = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'stream_questions'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user_email}: {self.question_text[:30]}..."

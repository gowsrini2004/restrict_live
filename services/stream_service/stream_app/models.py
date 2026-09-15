from django.db import models
import uuid
import re

class StreamConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200, default="International Retreat Live Stream")
    youtube_url = models.CharField(max_length=500, default="https://www.youtube.com/watch?v=jfKfPfyJRdk")
    youtube_video_id = models.CharField(max_length=50, default="jfKfPfyJRdk")
    is_live = models.BooleanField(default=True)
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
        return url_or_id

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

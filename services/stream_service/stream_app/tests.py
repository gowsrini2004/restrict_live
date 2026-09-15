from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status
from stream_app.models import StreamConfig, Question
from services.auth_service.users.utils import generate_jwt_token
from services.common.redis_client import SessionManager
import uuid

class StreamServiceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_id = str(uuid.uuid4())
        self.user_email = "viewer@example.com"
        self.token, self.session_id = generate_jwt_token(self.user_id, self.user_email, is_admin=False)
        SessionManager.set_active_session(self.user_id, self.user_email, self.session_id)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

    def test_youtube_video_id_extraction(self):
        """Tests extracting video ID from standard YouTube links."""
        url = "https://www.youtube.com/watch?v=jfKfPfyJRdk"
        vid_id = StreamConfig.extract_video_id(url)
        self.assertEqual(vid_id, "jfKfPfyJRdk")

        short_url = "https://youtu.be/jfKfPfyJRdk"
        self.assertEqual(StreamConfig.extract_video_id(short_url), "jfKfPfyJRdk")

    def test_question_submission_and_upvote(self):
        """Tests submitting a question and upvoting it."""
        res = self.client.post('/api/v1/questions/', {
            'question_text': "What is the schedule for the afternoon retreat session?"
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        q_id = res.data['data']['id']

        upvote_res = self.client.post(f'/api/v1/questions/{q_id}/upvote/')
        self.assertEqual(upvote_res.status_code, status.HTTP_200_OK)
        self.assertEqual(upvote_res.data['data']['upvotes'], 1)

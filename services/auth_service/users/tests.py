from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status
from users.models import AuthorizedUser, SystemConfig
from services.common.redis_client import SessionManager

class AuthSingleSessionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.email = "attendee@example.com"
        self.passcode = "IRK2026"
        # Seed initial config
        SystemConfig.objects.create(key='COMMON_PASSCODE', value=self.passcode)
        AuthorizedUser.objects.create(email=self.email, is_active=True)

    def test_single_device_session_eviction(self):
        """Tests that logging in on Device 2 invalidates Device 1's active session."""
        # Device 1 login
        res1 = self.client.post('/api/v1/auth/login/', {
            'email': self.email,
            'passcode': self.passcode
        })
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        token1 = res1.data['data']['token']

        # Verify Device 1 heartbeat succeeds
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token1}')
        hb1 = self.client.post('/api/v1/auth/heartbeat/')
        self.assertEqual(hb1.status_code, status.HTTP_200_OK)

        # Device 2 login (Same user email)
        res2 = self.client.post('/api/v1/auth/login/', {
            'email': self.email,
            'passcode': self.passcode
        })
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        token2 = res2.data['data']['token']

        # Verify Device 1's token now receives 401 SESSION_EVICTED
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token1}')
        hb1_evicted = self.client.post('/api/v1/auth/heartbeat/')
        self.assertEqual(hb1_evicted.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(hb1_evicted.data['error']['code'], 'SESSION_EVICTED')

        # Verify Device 2 heartbeat succeeds
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token2}')
        hb2 = self.client.post('/api/v1/auth/heartbeat/')
        self.assertEqual(hb2.status_code, status.HTTP_200_OK)

    def test_bulk_user_import(self):
        """Tests admin bulk importing emails via text."""
        admin_res = self.client.post('/api/v1/auth/login/', {
            'email': 'admin@chennaimath.org',
            'passcode': 'ADMIN2026'
        })
        admin_token = admin_res.data['data']['token']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {admin_token}')

        import_res = self.client.post('/api/v1/admin/users/bulk-import/', {
            'raw_emails': "user1@example.com\nuser2@example.com\ninvalid-email-text"
        })
        self.assertEqual(import_res.status_code, status.HTTP_200_OK)
        self.assertEqual(import_res.data['data']['created_count'], 2)
        self.assertEqual(len(import_res.data['data']['invalid_entries']), 1)

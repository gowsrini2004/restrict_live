from django.urls import path
from . import views

urlpatterns = [
    path('auth/login/', views.login_view, name='auth_login'),
    path('auth/refresh/', views.refresh_token_view, name='auth_refresh'),
    path('auth/heartbeat/', views.heartbeat_view, name='auth_heartbeat'),
    path('auth/logout/', views.logout_view, name='auth_logout'),
    path('admin/metrics/live-viewers/', views.live_metrics_view, name='admin_live_metrics'),
    path('admin/users/create/', views.create_single_user_view, name='admin_create_user'),
    path('admin/users/<uuid:user_id>/toggle-status/', views.toggle_user_status_view, name='admin_toggle_user_status'),
    path('admin/users/<uuid:user_id>/', views.delete_user_view, name='admin_delete_user'),
    path('admin/users/bulk-import/', views.bulk_import_users_view, name='admin_bulk_import'),
    path('admin/users/', views.list_users_view, name='admin_list_users'),
    path('admin/config/passcode/', views.system_config_view, name='admin_config_passcode'),
    path('admin/failure-logs/', views.list_failure_logs, name='admin_failure_logs'),
]

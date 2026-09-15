from django.urls import path
from . import views

urlpatterns = [
    path('stream/config/', views.get_stream_config, name='get_stream_config'),
    path('admin/stream/config/', views.update_stream_config, name='update_stream_config'),
    path('admin/stream/toggle-live/', views.toggle_live_status, name='toggle_live_status'),
    path('questions/', views.questions_view, name='questions_view'),
    path('questions/<uuid:question_id>/upvote/', views.upvote_question_view, name='upvote_question'),
    path('admin/questions/', views.admin_list_questions, name='admin_list_questions'),
    path('admin/questions/<uuid:question_id>/', views.admin_moderate_question, name='admin_moderate_question'),
]

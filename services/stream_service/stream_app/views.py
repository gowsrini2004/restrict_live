from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache
from django.db.models import F
from .models import StreamConfig, Question
from .serializers import StreamConfigSerializer, QuestionSerializer, AdminQuestionModerationSerializer
from services.auth_service.users.auth_helpers import enforce_active_session, require_admin

@api_view(['GET'])
def get_stream_config(request):
    """
    Returns active stream configuration for live users (live status, video ID, offline banner).
    """
    config = StreamConfig.objects.first()
    if not config:
        config = StreamConfig.objects.create(
            title="International Retreat Live Stream",
            youtube_url="https://www.youtube.com/watch?v=jfKfPfyJRdk",
            youtube_video_id="jfKfPfyJRdk",
            is_live=True
        )
    return Response({
        "success": True,
        "data": StreamConfigSerializer(config).data
    })

@api_view(['POST'])
@require_admin
def update_stream_config(request):
    """
    Admin endpoint to set or update YouTube Live stream link, title, and offline banner.
    """
    config = StreamConfig.objects.first()
    if not config:
        config = StreamConfig()

    serializer = StreamConfigSerializer(config, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    
    if 'youtube_url' in serializer.validated_data:
        youtube_url = serializer.validated_data['youtube_url']
        config.youtube_video_id = StreamConfig.extract_video_id(youtube_url)
        config.youtube_url = youtube_url
    if 'title' in serializer.validated_data:
        config.title = serializer.validated_data['title']
    if 'is_live' in serializer.validated_data:
        config.is_live = serializer.validated_data['is_live']
    if 'is_playback_mode' in serializer.validated_data:
        config.is_playback_mode = serializer.validated_data['is_playback_mode']
    if 'offline_image_url' in serializer.validated_data:
        config.offline_image_url = serializer.validated_data['offline_image_url']
    if 'offline_message' in serializer.validated_data:
        config.offline_message = serializer.validated_data['offline_message']

    config.save()

    return Response({
        "success": True,
        "data": StreamConfigSerializer(config).data
    })

@api_view(['POST'])
@require_admin
def toggle_live_status(request):
    """
    Admin endpoint to start or stop live broadcast with a single click.
    """
    config = StreamConfig.objects.first()
    if not config:
        config = StreamConfig.objects.create()

    if 'is_live' in request.data:
        config.is_live = bool(request.data['is_live'])
    else:
        config.is_live = not config.is_live

    config.save()

    return Response({
        "success": True,
        "data": StreamConfigSerializer(config).data
    })

@api_view(['POST'])
@require_admin
def toggle_playback_mode(request):
    """
    Admin endpoint to enable/disable Playback Mode with a single click —
    intended for once a broadcast has ended, letting viewers log in and
    watch the recording back through the same protected player.
    """
    config = StreamConfig.objects.first()
    if not config:
        config = StreamConfig.objects.create()

    if 'is_playback_mode' in request.data:
        config.is_playback_mode = bool(request.data['is_playback_mode'])
    else:
        config.is_playback_mode = not config.is_playback_mode

    config.save()

    return Response({
        "success": True,
        "data": StreamConfigSerializer(config).data
    })

@api_view(['GET', 'POST'])
@enforce_active_session
def questions_view(request):
    """
    User endpoint to view approved questions or submit a new question.
    """
    if request.method == 'GET':
        questions = Question.objects.filter(status__in=['APPROVED', 'ANSWERED']).order_by('-upvotes', '-created_at')[:100]
        serializer = QuestionSerializer(questions, many=True)
        return Response({
            "success": True,
            "data": {
                "questions": serializer.data
            }
        })
    else:
        claims = request.user_claims
        user_email = claims.get('email', 'anonymous')
        
        serializer = QuestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        question = Question.objects.create(
            user_email=user_email,
            question_text=serializer.validated_data['question_text'],
            status='APPROVED'
        )

        return Response({
            "success": True,
            "data": QuestionSerializer(question).data
        }, status=status.HTTP_201_CREATED)

@api_view(['POST'])
@enforce_active_session
def upvote_question_view(request, question_id):
    """
    User endpoint to upvote a question. Each user can upvote a specific question only once.
    """
    claims = request.user_claims
    user_id = claims.get('user_id', 'anonymous')
    cache_key = f"upvoted_question:{user_id}:{question_id}"

    if cache.get(cache_key):
        return Response({
            "success": False,
            "error": {
                "code": "ALREADY_UPVOTED",
                "message": "You have already upvoted this question.",
                "details": {}
            }
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Atomic DB-level increment (not read-modify-write) so concurrent
        # upvotes from many viewers at once can't silently overwrite each
        # other and lose increments under load.
        updated = Question.objects.filter(id=question_id).update(upvotes=F('upvotes') + 1)
        if not updated:
            raise Question.DoesNotExist
        question = Question.objects.get(id=question_id)

        # Remember user's upvote in Redis cache for 7 days
        cache.set(cache_key, True, timeout=86400 * 7)

        return Response({
            "success": True,
            "data": QuestionSerializer(question).data
        })
    except Question.DoesNotExist:
        return Response({
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "Question not found.",
                "details": {}
            }
        }, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
@require_admin
def admin_list_questions(request):
    """
    Admin endpoint returning all questions (including pending, approved, answered).
    """
    questions = Question.objects.all().order_by('-created_at')[:200]
    serializer = QuestionSerializer(questions, many=True)
    return Response({
        "success": True,
        "data": {
            "questions": serializer.data
        }
    })

@api_view(['PATCH', 'DELETE'])
@require_admin
def admin_moderate_question(request, question_id):
    """
    Admin endpoint to approve, answer, or delete questions.
    """
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return Response({
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "Question not found.",
                "details": {}
            }
        }, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        question.delete()
        return Response({
            "success": True,
            "data": {"message": "Question deleted successfully."}
        })

    serializer = AdminQuestionModerationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    question.status = serializer.validated_data['status']
    question.save(update_fields=['status'])

    return Response({
        "success": True,
        "data": QuestionSerializer(question).data
    })

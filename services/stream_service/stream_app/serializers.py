from rest_framework import serializers
from django.utils.html import escape
from .models import StreamConfig, Question

class StreamConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = StreamConfig
        fields = ['id', 'title', 'youtube_url', 'youtube_video_id', 'is_live', 'offline_image_url', 'offline_message', 'updated_at']
        read_only_fields = ['id', 'youtube_video_id', 'updated_at']

    def validate_youtube_url(self, value):
        video_id = StreamConfig.extract_video_id(value)
        # Real YouTube video IDs are always exactly 11 characters. Anything
        # else means the URL didn't match a known format — reject it here
        # rather than silently saving the raw (possibly very long) input,
        # which previously overflowed the youtube_video_id column and
        # crashed the request with a 500 error.
        if not video_id or len(video_id) != 11:
            raise serializers.ValidationError("Invalid YouTube URL or Video ID format.")
        return value

class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = ['id', 'user_email', 'question_text', 'status', 'upvotes', 'created_at']
        read_only_fields = ['id', 'user_email', 'status', 'upvotes', 'created_at']

    def validate_question_text(self, value):
        clean_text = escape(value.strip())
        if not clean_text:
            raise serializers.ValidationError("Question content cannot be empty.")
        if len(clean_text) < 5:
            raise serializers.ValidationError("Question must be at least 5 characters long.")
        if len(clean_text) > 1000:
            raise serializers.ValidationError("Question cannot exceed 1000 characters.")
        return clean_text

class AdminQuestionModerationSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Question.STATUS_CHOICES, required=True)

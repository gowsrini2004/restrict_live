from rest_framework import serializers
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from .models import AuthorizedUser, SystemConfig
import io
import csv

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True, error_messages={
        "invalid": "Please enter a valid email address.",
        "required": "Email address is required."
    })
    passcode = serializers.CharField(required=True, write_only=True, error_messages={
        "required": "Event passcode is required."
    })

    def validate_email(self, value):
        return value.lower().strip()

class BulkUserImportSerializer(serializers.Serializer):
    csv_file = serializers.FileField(required=False)
    raw_emails = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        csv_file = data.get('csv_file')
        raw_emails = data.get('raw_emails')

        if not csv_file and not raw_emails:
            raise serializers.ValidationError({"non_field_errors": ["Please provide a CSV file or paste email text."]})

        emails_to_import = set()
        invalid_entries = []

        if csv_file:
            if not csv_file.name.endswith(('.csv', '.txt')):
                raise serializers.ValidationError({"csv_file": ["Only .csv and .txt files are supported."]})
            
            try:
                decoded_file = csv_file.read().decode('utf-8-sig')
                io_string = io.StringIO(decoded_file)
                reader = csv.reader(io_string)
                
                for row_idx, row in enumerate(reader, start=1):
                    if not row:
                        continue
                    raw = row[0].strip()
                    if not raw or raw.lower() == 'email':
                        continue
                    try:
                        validate_email(raw)
                        emails_to_import.add(raw.lower())
                    except ValidationError:
                        invalid_entries.append(f"Row {row_idx}: {raw}")
            except Exception as e:
                raise serializers.ValidationError({"csv_file": [f"Failed to read CSV file: {str(e)}"]})

        if raw_emails:
            lines = raw_emails.splitlines()
            for line_idx, line in enumerate(lines, start=1):
                clean_line = line.strip().strip(',;')
                if not clean_line or clean_line.lower() == 'email':
                    continue
                try:
                    validate_email(clean_line)
                    emails_to_import.add(clean_line.lower())
                except ValidationError:
                    invalid_entries.append(f"Line {line_idx}: {clean_line}")

        data['validated_emails'] = list(emails_to_import)
        data['invalid_entries'] = invalid_entries
        return data

class AuthorizedUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuthorizedUser
        fields = ['id', 'email', 'is_active', 'is_admin', 'is_super_admin', 'created_at', 'last_login_at']
        read_only_fields = ['id', 'created_at', 'last_login_at']

class CreateUserSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    role = serializers.ChoiceField(choices=['attendee', 'admin'], default='attendee')

    def validate_email(self, value):
        clean = value.lower().strip()
        if AuthorizedUser.objects.filter(email=clean).exists():
            raise serializers.ValidationError("A user with this email address already exists in the roster.")
        return clean

class SystemConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemConfig
        fields = ['key', 'value', 'updated_at']
        read_only_fields = ['updated_at']

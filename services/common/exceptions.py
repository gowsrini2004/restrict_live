import logging
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError

logger = logging.getLogger(__name__)

def custom_exception_handler(exc, context):
    """
    Production-grade global exception handler for Django REST Framework.
    Ensures a standardized error envelope for all exception types.
    
    Standardized Error Output format:
    {
        "success": False,
        "error": {
            "code": "ERROR_CODE",
            "message": "Human readable error summary",
            "details": { ... }
        },
        "timestamp": "ISO-Timestamp"
    }
    """
    import datetime
    
    # Handle Django validation errors if raised directly
    if isinstance(exc, DjangoValidationError):
        if hasattr(exc, 'message_dict'):
            detail = exc.message_dict
        else:
            detail = {'non_field_errors': exc.messages}
        exc = DRFValidationError(detail)

    response = exception_handler(exc, context)

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if response is not None:
        error_code = "API_ERROR"
        if response.status_code == 400:
            error_code = "VALIDATION_ERROR"
        elif response.status_code == 401:
            error_code = getattr(exc, 'error_code', 'UNAUTHORIZED')
        elif response.status_code == 403:
            error_code = "PERMISSION_DENIED"
        elif response.status_code == 404:
            error_code = "NOT_FOUND"
        elif response.status_code == 429:
            error_code = "RATE_LIMITED"

        details = response.data if isinstance(response.data, dict) else {"detail": response.data}
        message = "An error occurred while processing your request."
        
        if "detail" in details and isinstance(details["detail"], str):
            message = details.pop("detail")
        elif "non_field_errors" in details and isinstance(details["non_field_errors"], list):
            message = details["non_field_errors"][0]
        elif isinstance(details, dict) and details:
            message = "Validation failed for input data."

        response.data = {
            "success": False,
            "error": {
                "code": error_code,
                "message": message,
                "details": details
            },
            "timestamp": now_iso
        }
        return response

    # Unhandled server errors (500)
    logger.error(f"Unhandled Exception: {exc}", exc_info=True)
    return Response(
        {
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected server error occurred. Please try again later.",
                "details": {}
            },
            "timestamp": now_iso
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR
    )

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string) || message;
        error = (responseObj.error as string) || error;
      }
    }

    // Log the full error details for debugging
    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    // Send user-friendly error response
    response.status(status).json({
      success: false,
      statusCode: status,
      error,
      message: this.getUserFriendlyMessage(exception, message),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private getUserFriendlyMessage(exception: unknown, defaultMessage: string): string {
    // Prisma errors
    if (exception instanceof Error && exception.message.includes('Prisma')) {
      if (exception.message.includes('does not exist')) {
        return 'Database configuration error. Please contact support.';
      }
      if (exception.message.includes('Unique constraint')) {
        return 'This record already exists.';
      }
      if (exception.message.includes('Foreign key constraint')) {
        return 'Cannot perform this action due to related data.';
      }
      if (exception.message.includes("Can't reach database")) {
        return 'Database connection error. Please try again later.';
      }
      return 'A database error occurred. Please try again.';
    }

    // Network errors
    if (exception instanceof Error && exception.message.includes('ECONNREFUSED')) {
      return 'Service temporarily unavailable. Please try again later.';
    }

    // Validation errors
    if (exception instanceof HttpException && exception.getStatus() === 400) {
      return defaultMessage;
    }

    // Default user-friendly message
    return 'An unexpected error occurred. Please try again.';
  }
}

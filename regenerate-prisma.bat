@echo off
echo ========================================
echo Regenerating Prisma Client
echo ========================================
echo.
echo This will regenerate the Prisma client to include moveTimeoutSeconds field.
echo.
echo IMPORTANT: Make sure your server is stopped before running this!
echo.
pause

echo.
echo Regenerating Prisma client...
call npx prisma generate

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Prisma client regenerated.
    echo ========================================
    echo.
    echo You can now restart your server with:
    echo   npm run start:dev
    echo.
) else (
    echo.
    echo ========================================
    echo ERROR: Failed to regenerate Prisma client
    echo ========================================
    echo.
    echo This usually means the server is still running.
    echo Please stop the server and try again.
    echo.
)

pause

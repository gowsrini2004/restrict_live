# One-Click Master Launcher for Live Stream Microservices Platform
Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "🚀 Launching Live Streaming & Q&A Microservices Platform..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Yellow

# 1. Start Docker Containers
Write-Host "`n[1/4] Starting Docker Microservices (PostgreSQL, Redis, Auth, Stream, Gateway)..." -ForegroundColor Yellow
docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker failed to start. Please ensure Docker Desktop is running." -ForegroundColor Red
    exit 1
}

# 2. Run Database Migrations
Write-Host "`n[2/4] Running PostgreSQL Database Migrations..." -ForegroundColor Yellow
docker-compose exec -T auth_service python manage.py migrate --noinput
docker-compose exec -T stream_service python manage.py migrate --noinput

# 3. Start Frontend Development Server
Write-Host "`n[3/4] Launching React Frontend Server..." -ForegroundColor Yellow
$frontendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot/frontend'; npm run dev" -PassThru

# 4. Wait & Open in Browser / Chrome
Write-Host "`n[4/4] Opening Application in Browser..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

$url = "http://localhost:5173"
try {
    # Try opening Google Chrome specifically if installed, else fallback to default browser
    if (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe") {
        Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" $url
    } elseif (Test-Path "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") {
        Start-Process "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" $url
    } else {
        Start-Process $url
    }
} catch {
    Start-Process $url
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "✅ PLATFORM IS LIVE & READY!" -ForegroundColor Green
Write-Host "   Frontend URL:  http://localhost:5173" -ForegroundColor White
Write-Host "   API Gateway:   http://localhost:8080" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green

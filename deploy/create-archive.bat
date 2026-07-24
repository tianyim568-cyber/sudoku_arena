@echo off
REM Create deployment archive for Alibaba Cloud
REM Run this from the project root directory

echo Creating deployment archive...

REM Create tar archive excluding unnecessary files
tar -czf sudoku-arena.tar.gz ^
  --exclude="node_modules" ^
  --exclude=".git" ^
  --exclude="server\.env" ^
  --exclude="server\.env.local" ^
  --exclude="server\.env.*.local" ^
  --exclude="*.log" ^
  --exclude=".claude" ^
  --exclude=".DS_Store" ^
  --exclude="Thumbs.db" ^
  --exclude="client\dist" ^
  --exclude="client\node_modules" ^
  --exclude="client\.env" ^
  --exclude="client\.env.local" ^
  --exclude="client\.env.*.local" ^
  --exclude=".cowork-temp" ^
  --exclude="docs" ^
  .

echo.
echo Archive created: sudoku-arena.tar.gz
echo.
echo Next steps:
echo 1. Upload to your Alibaba Cloud server:
echo    scp sudoku-arena.tar.gz root@YOUR_SERVER_IP:/tmp/
echo.
echo 2. SSH into the server and run deployment:
echo    ssh root@YOUR_SERVER_IP
echo    cd /tmp
echo    chmod +x deploy.sh
echo    ./deploy.sh
echo.
pause

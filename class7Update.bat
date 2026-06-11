@echo off
setlocal enabledelayedexpansion

set FORCE=false
set MSG=

:parse
if "%~1"=="" goto :checkForce
if /i "%~1"=="-f" (
    set FORCE=true
    shift
    goto :parse
)
if /i "%~1"=="-m" (
    if "%~2"=="" (
        echo 警告: -m 后未提供信息，将进入交互提示
        shift
        goto :parse
    ) else (
        set "MSG=%~2"
        shift
        shift
        goto :parse
    )
)
if /i "%~1"=="-h" goto :help
if /i "%~1"=="--help" goto :help
echo 未知参数: %~1
exit /b 1

:help
echo 用法: %~nx0 [-f] [-m "提交信息"]
echo   -f  强制模式，跳过远程差异检查
echo   -m  提交信息
exit /b 0

:checkForce
if not defined MSG (
    set /p MSG="commit message: "
    if not defined MSG set "MSG=a minor update"
)

if /i "%FORCE%"=="true" goto :push

echo ==^> 获取远程最新状态...
git fetch origin
if %errorlevel% neq 0 (
    echo 获取失败，请检查网络或SSH配置
    exit /b 1
)

for /f "tokens=*" %%i in ('git branch --show-current') do set "BRANCH=%%i"
if "%BRANCH%"=="" (
    echo 无法检测当前分支
    exit /b 1
)

git diff --name-only HEAD "origin/%BRANCH%" > %temp%\diff_files.txt 2>&1
set HAS_DIFF=false
for %%F in (%temp%\diff_files.txt) do if %%~zF gtr 0 set HAS_DIFF=true
if "%HAS_DIFF%"=="true" (
    echo.
    echo 警告: 本地与远程 %BRANCH% 存在差异的文件:
    type %temp%\diff_files.txt
    echo.
    set /p answer="是否需要执行 git pull 以同步远程更新? (y/n): "
    if /i "!answer!"=="y" (
        echo ==^> git pull
        git pull
        echo 已同步远程更新。程序结束。
    ) else (
        echo 跳过拉取，程序结束。请手动解决差异后再提交。
    )
    del %temp%\diff_files.txt 2>nul
    exit /b 0
) else (
    echo 本地与远程无差异，继续推送流程...
)
del %temp%\diff_files.txt 2>nul

:push
echo ==^> git add .
git add .
echo ==^> git commit -m "!MSG!"
git commit -m "!MSG!"
echo ==^> git branch -M main
git branch -M main
echo ==^> git push -u origin main -v
git push -u origin main -v
echo 推送完成！
exit /b 0

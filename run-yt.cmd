@echo off
setlocal

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

set "URL=%~1"
if "%URL%"=="" set "URL=https://youtu.be/64i0XngEdn8?si=YQzXK1qI9c718k4Z"

"%NODE_EXE%" "%~dp0bin\aniterm.cjs" "%URL%" --profile quality --render auto --dither ordered --fps 34 --adaptive on

endlocal

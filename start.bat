@echo off
setlocal

REM Start all services using root package.json scripts
pushd "%~dp0"

npm start

popd
endlocal

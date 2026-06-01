@echo off
cd /d "%~dp0"

echo Starting Local Server on http://localhost:8000 ...
echo Press Ctrl+C to stop the server.

:: ブラウザで index.html を開く
start http://localhost:8000/index.html

:: 完全に1行にまとめたPowerShellスクリプト（MIMEタイプ・COOP/COEPヘッダー付与）
powershell -Command "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:8000/'); $listener.Start(); while ($listener.IsListening) { $context = $listener.GetContext(); $req = $context.Request; $res = $context.Response; $path = Join-Path (Get-Location) $req.Url.LocalPath.TrimStart('/'); if ($req.Url.LocalPath -eq '/') { $path = Join-Path (Get-Location) 'index.html' } if (Test-Path $path -PathType Leaf) { $ext = [System.IO.Path]::GetExtension($path).ToLower(); $mime = 'application/octet-stream'; if ($ext -eq '.html' -or $ext -eq '.htm') { $mime = 'text/html; charset=utf-8' } elseif ($ext -eq '.js') { $mime = 'application/javascript; charset=utf-8' } elseif ($ext -eq '.css') { $mime = 'text/css; charset=utf-8' } elseif ($ext -eq '.wasm') { $mime = 'application/wasm' } elseif ($ext -eq '.json') { $mime = 'application/json; charset=utf-8' }; $res.Headers.Add('Content-Type', $mime); $res.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin'); $res.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp'); $bytes = [System.IO.File]::ReadAllBytes($path); $res.OutputStream.Write($bytes, 0, $bytes.Length) } else { $res.StatusCode = 404 }; $res.Close() }"

pause
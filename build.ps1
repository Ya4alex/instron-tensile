# Сборка под Windows: vite build → gzip app.html → go build → instron-lab.exe
# Требования: Node.js, Go в PATH
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Push-Location app
npm ci
npx vite build
Pop-Location

# gzip через .NET (отдельный gzip на Windows не нужен)
$src = [IO.File]::ReadAllBytes('app\dist\index.html')
$ms = New-Object IO.MemoryStream
$gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionLevel]::Optimal)
$gz.Write($src, 0, $src.Length)
$gz.Close()
[IO.File]::WriteAllBytes('launcher\app.html.gz', $ms.ToArray())

Push-Location launcher
go build -ldflags="-s -w -H windowsgui" -o instron-lab.exe .
Pop-Location

Write-Host "Готово: launcher\instron-lab.exe"

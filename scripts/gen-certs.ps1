# Genera un certificado X509 autofirmado para desarrollo (TP2).
# Salida: certs\server.key y certs\server.crt (ignorados por git).
# Usa el openssl que trae Git for Windows si no hay uno en el PATH.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$certs = Join-Path $root 'certs'
New-Item -ItemType Directory -Force -Path $certs | Out-Null

$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  $candidates = @(
    'C:\Program Files\Git\usr\bin\openssl.exe',
    'C:\Program Files\Git\mingw64\bin\openssl.exe'
  )
  $openssl = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $openssl) { throw 'No se encontró openssl. Instalá Git for Windows o agregá openssl al PATH.' }

& $openssl req -x509 -newkey rsa:2048 -nodes -days 365 `
  -keyout (Join-Path $certs 'server.key') -out (Join-Path $certs 'server.crt') `
  -subj '/C=AR/O=Voltix/CN=localhost' `
  -addext 'subjectAltName=DNS:localhost,DNS:auth-service,DNS:catalog-service,DNS:inventory-service,DNS:orders-service,IP:127.0.0.1'
if ($LASTEXITCODE -ne 0) { throw 'openssl falló al generar el certificado.' }

Write-Host "Certificado generado en $certs\server.crt (válido 365 días)"
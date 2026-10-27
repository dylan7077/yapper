# Yapper installer for Windows 10/11.
#
#   irm https://raw.githubusercontent.com/dylan7077/yapper/main/install.ps1 | iex
#
# Installs Node.js LTS if needed, downloads Yapper to %USERPROFILE%\yapper, installs its packages,
# sets it up to start when you sign in, and opens the dashboard.
# Run it again any time to update; your settings in yapper\storage are kept.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:YAPPER_REPO) { $env:YAPPER_REPO } else { 'dylan7077/yapper' }
$Branch = if ($env:YAPPER_BRANCH) { $env:YAPPER_BRANCH } else { 'main' }
$Dir = if ($env:YAPPER_DIR) { $env:YAPPER_DIR } else { Join-Path $HOME 'yapper' }
$Port = '3080'
# For testing: install from a local .zip instead of GitHub, and/or skip the auto-start task.
$LocalZip = $env:YAPPER_ZIP
$NoService = $env:YAPPER_SERVICE -eq 'no'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor White }
function Ok($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Fail($text) { Write-Host "`n  [x] $text`n" -ForegroundColor Red; exit 1 }

Write-Host "`nYapper installer" -ForegroundColor White
Write-Host "Your own AI bot for Discord - Windows" -ForegroundColor DarkGray

# ---------- Node.js ----------
Step 'Checking Node.js'
function Get-NodeMajor { try { [int]((& node -p "process.versions.node.split('.')[0]") 2>$null) } catch { 0 } }
if ((Get-NodeMajor) -lt 22) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail 'Install Node.js 22 LTS from https://nodejs.org and run this again.' }
  Write-Host '  Installing Node.js LTS with winget...'
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Null
  # Pick up the new PATH without opening a new window.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Get-NodeMajor) -lt 22) { Fail 'Node.js was installed but isn''t available yet. Open a new PowerShell window and run this again.' }
}
Ok "Node.js $(node -v)"

# ---------- Download ----------
Step "Downloading Yapper to $Dir"
$zip = Join-Path $env:TEMP "yapper-$([guid]::NewGuid().ToString('N')).zip"
$unzipped = "$zip.d"
if ($LocalZip) { Copy-Item $LocalZip $zip } else { Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip -UseBasicParsing }
Expand-Archive $zip -DestinationPath $unzipped -Force
$src = (Get-ChildItem $unzipped -Directory | Select-Object -First 1).FullName
New-Item -ItemType Directory -Force $Dir | Out-Null
# storage\ and .env aren't in the download, so settings are kept.
Copy-Item -Path (Join-Path $src '*') -Destination $Dir -Recurse -Force
Remove-Item $zip, $unzipped -Recurse -Force
Ok 'Downloaded'

Step 'Installing packages'
Push-Location $Dir
try { & npm.cmd ci --omit=dev --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE) { Fail 'npm install failed (see above).' } } finally { Pop-Location }
New-Item -ItemType Directory -Force (Join-Path $Dir 'storage') | Out-Null
Ok 'Installed'

# ---------- Auto-start ----------
if ($NoService) { Write-Host "`nInstalled to $Dir. Start it with:  cd $Dir; npm start`n"; return }
Step 'Setting up auto-start'
$task = Get-ScheduledTask -TaskName 'Yapper' -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName 'Yapper' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
& (Join-Path $Dir 'deploy\install-windows.ps1') | Out-Null
Ok 'Starts when you sign in to Windows (Task Scheduler: "Yapper")'

# ---------- Done ----------
$codeFile = Join-Path $Dir 'storage\setup-code.txt'
$adminFile = Join-Path $Dir 'storage\admin.json'
for ($i = 0; $i -lt 30 -and -not (Test-Path $codeFile) -and -not (Test-Path $adminFile); $i++) { Start-Sleep -Seconds 1 }
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress

Write-Host "`nYapper is running.`n" -ForegroundColor Green
Write-Host "  Open the dashboard:  http://localhost:$Port"
if ($ip) { Write-Host "  From another device: http://${ip}:$Port  (allow port $Port in Windows Firewall first)" }
if (Test-Path $codeFile) { Write-Host "  Setup code:          $((Get-Content $codeFile -Raw).Trim())" -ForegroundColor White }
elseif (Test-Path $adminFile) { Write-Host '  Sign in with your dashboard password.' }
else { Write-Host "  The setup code is in $Dir\storage\yapper.log" }
Write-Host "`n  The setup guide in the dashboard walks you through the rest.`n"
Start-Process "http://localhost:$Port"

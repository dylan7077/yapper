# Registers Yapper as a Windows scheduled task that starts when you sign in and restarts if it stops.
# Run from the yapper folder in PowerShell:   powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1
# Remove it again:                              Unregister-ScheduledTask -TaskName Yapper -Confirm:$false
$ErrorActionPreference = 'Stop'
$dir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force (Join-Path $dir 'storage') | Out-Null
$log = Join-Path $dir 'storage\yapper.log'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $dir `
  -Argument "/c `"`"$node`" --env-file-if-exists=.env src\main.js >> `"$log`" 2>&1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Yapper' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Yapper Discord AI bot + dashboard' -Force | Out-Null
Start-ScheduledTask -TaskName 'Yapper'

Start-Sleep -Seconds 4
Write-Host "Yapper is running. Dashboard: http://localhost:3080"
Get-Content $log -Tail 5

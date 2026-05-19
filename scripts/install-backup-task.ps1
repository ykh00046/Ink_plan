$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$taskName = "InkPlanDailyBackup"
$script = Join-Path $root "backup-now.vbs"
$taskRun = "wscript.exe `"$script`""

schtasks.exe /Create /TN $taskName /TR $taskRun /SC DAILY /ST 18:30 /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install scheduled task. Exit code: $LASTEXITCODE"
}

Write-Host "Installed scheduled backup task: $taskName (daily 18:30)"

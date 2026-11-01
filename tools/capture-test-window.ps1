param([string]$OutputName = 'initial-window-native.png')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $taskRoot 'runtime'
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRuntime 'environment.local.json') -Raw | ConvertFrom-Json
if ($taskConfig.projectId -ne 'zotero-doubao-translate-dev-v1') { throw 'Unknown test environment' }
if ($OutputName -notmatch '^[a-zA-Z0-9_-]+\.png$') { throw 'Output must be a simple PNG filename' }
$taskCandidates = @(Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains('-profile') -and $_.CommandLine.Contains($taskConfig.profile) -and $_.CommandLine.Contains($taskConfig.data) -and -not $_.CommandLine.Contains('-contentproc')
})
if ($taskCandidates.Count -ne 1) { throw 'Expected exactly one registered test parent' }
$taskApp = Get-Process -Id $taskCandidates[0].ProcessId
if (-not $taskApp.MainWindowHandle) { throw 'Test window is not ready' }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TestWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@
[TestWindowCapture]::SetProcessDPIAware() | Out-Null
$taskRect = New-Object TestWindowCapture+Rect
if (-not [TestWindowCapture]::GetWindowRect($taskApp.MainWindowHandle, [ref]$taskRect)) { throw 'Cannot read test window bounds' }
$taskWidth = $taskRect.Right - $taskRect.Left
$taskHeight = $taskRect.Bottom - $taskRect.Top
$taskBitmap = New-Object System.Drawing.Bitmap($taskWidth,$taskHeight)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskDC = $taskGraphics.GetHdc()
try { $taskCaptured = [TestWindowCapture]::PrintWindow($taskApp.MainWindowHandle,$taskDC,2) }
finally { $taskGraphics.ReleaseHdc($taskDC) }
if (-not $taskCaptured) { $taskGraphics.Dispose(); $taskBitmap.Dispose(); throw 'PrintWindow did not capture test window' }
$taskOutput = Join-Path $taskRuntime $OutputName
try { $taskBitmap.Save($taskOutput,[System.Drawing.Imaging.ImageFormat]::Png) }
finally { $taskGraphics.Dispose(); $taskBitmap.Dispose() }
[pscustomobject]@{ path=$taskOutput; pid=$taskApp.Id; width=$taskWidth; height=$taskHeight; dpi=[TestWindowCapture]::GetDpiForWindow($taskApp.MainWindowHandle); title=$taskApp.MainWindowTitle } | ConvertTo-Json

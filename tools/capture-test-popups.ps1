param([string]$OutputName = 'test-popup.png')
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
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder text, int max);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@
[TestWindowCapture]::SetProcessDPIAware() | Out-Null
$taskWindows = [System.Collections.Generic.List[System.IntPtr]]::new()
$taskCallback = [TestWindowCapture+EnumProc]{param($windowHandle,$ignored)
  [uint32]$taskWindowPid=0
  [TestWindowCapture]::GetWindowThreadProcessId($windowHandle,[ref]$taskWindowPid) | Out-Null
  if ($taskWindowPid -eq $taskApp.Id -and $windowHandle -ne $taskApp.MainWindowHandle -and [TestWindowCapture]::IsWindowVisible($windowHandle)) { $taskWindows.Add($windowHandle) }
  return $true
}
[TestWindowCapture]::EnumWindows($taskCallback,[IntPtr]::Zero) | Out-Null
$taskResults = @()
foreach ($taskHandle in $taskWindows) {
  $taskRect=New-Object TestWindowCapture+Rect
  [TestWindowCapture]::GetWindowRect($taskHandle,[ref]$taskRect) | Out-Null
  $taskWidth=$taskRect.Right-$taskRect.Left; $taskHeight=$taskRect.Bottom-$taskRect.Top
  $taskClass=[System.Text.StringBuilder]::new(256)
  [TestWindowCapture]::GetClassName($taskHandle,$taskClass,256) | Out-Null
  if ($taskWidth -le 0 -or $taskHeight -le 0) { continue }
  $taskBitmap=New-Object System.Drawing.Bitmap($taskWidth,$taskHeight)
  $taskGraphics=[System.Drawing.Graphics]::FromImage($taskBitmap)
  $taskDC=$taskGraphics.GetHdc()
  try { $taskCaptured=[TestWindowCapture]::PrintWindow($taskHandle,$taskDC,2) }
  finally { $taskGraphics.ReleaseHdc($taskDC) }
  $taskOutput=Join-Path $taskRuntime ($OutputName.Replace('.png','-'+$taskHandle+'.png'))
  try { if($taskCaptured){$taskBitmap.Save($taskOutput,[System.Drawing.Imaging.ImageFormat]::Png)} }
  finally { $taskGraphics.Dispose();$taskBitmap.Dispose() }
  $taskResults += [pscustomobject]@{path=$taskOutput;pid=$taskApp.Id;handle=$taskHandle.ToInt64();class=$taskClass.ToString();width=$taskWidth;height=$taskHeight;captured=$taskCaptured}
}
ConvertTo-Json -InputObject $taskResults

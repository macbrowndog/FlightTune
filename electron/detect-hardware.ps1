$ErrorActionPreference = "SilentlyContinue"

function Convert-RegistryMemory {
  param($Value)
  if ($null -eq $Value) { return [uint64]0 }
  if ($Value -is [byte[]]) {
    $bytes = New-Object byte[] 8
    [Array]::Copy($Value, $bytes, [Math]::Min($Value.Length, 8))
    return [BitConverter]::ToUInt64($bytes, 0)
  }
  try { return [uint64]$Value } catch { return [uint64]0 }
}

function Convert-RegistryString {
  param($Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [byte[]]) {
    return [Text.Encoding]::Unicode.GetString($Value).Trim([char]0).Trim()
  }
  return ([string]$Value).Trim()
}

$cpu = Get-CimInstance Win32_Processor |
  Sort-Object NumberOfLogicalProcessors -Descending |
  Select-Object -First 1

$videoControllers = @(
  Get-CimInstance Win32_VideoController |
    Where-Object { $_.Name -and $_.Name -notmatch "Microsoft Basic|Remote Display|Parsec|Virtual" }
)

$registryAdapters = @(
  Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\Video" -Recurse |
    Where-Object { $_.PSChildName -match "^0000$" } |
    ForEach-Object {
      $properties = Get-ItemProperty $_.PSPath
      $memory = Convert-RegistryMemory $properties."HardwareInformation.qwMemorySize"
      if ($memory -eq 0) {
        $memory = Convert-RegistryMemory $properties."HardwareInformation.MemorySize"
      }
      [PSCustomObject]@{
        Name = Convert-RegistryString $properties."HardwareInformation.AdapterString"
        Memory = $memory
      }
    } |
    Where-Object { $_.Name -and $_.Memory -gt 0 }
)

$gpus = foreach ($controller in $videoControllers) {
  $matched = $registryAdapters |
    Where-Object {
      $controller.Name -like "*$($_.Name)*" -or $_.Name -like "*$($controller.Name)*"
    } |
    Sort-Object Memory -Descending |
    Select-Object -First 1

  $memory = if ($matched) {
    [uint64]$matched.Memory
  } elseif ($controller.AdapterRAM) {
    [uint64]$controller.AdapterRAM
  } else {
    [uint64]0
  }

  [PSCustomObject]@{
    Name = [string]$controller.Name
    Memory = $memory
  }
}

if (-not $gpus) {
  $gpus = @(
    $registryAdapters | ForEach-Object {
      [PSCustomObject]@{
        Name = $_.Name
        Memory = [uint64]$_.Memory
      }
    }
  )
}

$primaryGpu = $gpus |
  Sort-Object @{ Expression = {
    $score = [double]$_.Memory
    if ($_.Name -match "NVIDIA|GeForce|Radeon|AMD|Intel.*Arc") { $score += 100000000000 }
    if ($_.Name -match "Intel.*(UHD|Iris)|Integrated") { $score -= 50000000000 }
    $score
  }; Descending = $true } |
  Select-Object -First 1

$pnpNames = @(
  Get-PnpDevice -PresentOnly |
    Where-Object { $_.FriendlyName } |
    Select-Object -ExpandProperty FriendlyName
)
$pnpText = $pnpNames -join " | "

$headset = ""
switch -Regex ($pnpText) {
  "Quest 3S" { $headset = "Meta Quest 3 / 3S"; break }
  "Quest 3" { $headset = "Meta Quest 3 / 3S"; break }
  "Quest 2" { $headset = "Meta Quest 2"; break }
  "Quest Pro" { $headset = "Meta Quest Pro"; break }
  "Oculus|Meta Quest" { $headset = "Meta Quest / Oculus headset"; break }
  "Pimax" { $headset = "Pimax headset"; break }
  "Varjo" { $headset = "Varjo headset"; break }
  "Reverb|Mixed Reality.*Headset" { $headset = "HP Reverb / Windows Mixed Reality"; break }
  "VIVE|HTC.*VR" { $headset = "HTC Vive headset"; break }
  "PICO" { $headset = "Pico headset"; break }
  "Bigscreen Beyond" { $headset = "Bigscreen Beyond"; break }
}

$openXrRuntime = ""
foreach ($registryPath in @("HKCU:\SOFTWARE\Khronos\OpenXR\1", "HKLM:\SOFTWARE\Khronos\OpenXR\1")) {
  $candidate = (Get-ItemProperty $registryPath -Name ActiveRuntime).ActiveRuntime
  if ($candidate) { $openXrRuntime = [string]$candidate; break }
}

if (-not $headset -and $openXrRuntime) {
  switch -Regex ($openXrRuntime) {
    "oculus|meta" { $headset = "Meta Quest / Oculus (OpenXR runtime)"; break }
    "steamvr" { $headset = "SteamVR / OpenXR headset"; break }
    "pimax" { $headset = "Pimax (OpenXR runtime)"; break }
    "varjo" { $headset = "Varjo (OpenXR runtime)"; break }
    "mixedreality|windows.*xr" { $headset = "Windows Mixed Reality headset"; break }
    "vive" { $headset = "HTC Vive (OpenXR runtime)"; break }
  }
}

$vramBytes = if ($primaryGpu) { [uint64]$primaryGpu.Memory } else { [uint64]0 }
$vramGb = if ($vramBytes -gt 0) { [Math]::Round($vramBytes / 1GB, 1) } else { 0 }
$cpuName = if ($cpu.Name) {
  $cpu.Name.Trim()
} else {
  (Get-ItemProperty "HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0").ProcessorNameString
}
if (-not $cpuName) { $cpuName = $env:PROCESSOR_IDENTIFIER }

[PSCustomObject]@{
  cpu = if ($cpuName) { $cpuName.Trim() } else { "Unknown processor" }
  gpu = if ($primaryGpu.Name) { $primaryGpu.Name.Trim() } else { "Unknown graphics adapter" }
  vramGb = $vramGb
  display = if ($headset) { $headset } else { "No VR headset detected" }
  headsetDetected = [bool]$headset
  openXrRuntime = $openXrRuntime
  detectedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Compress

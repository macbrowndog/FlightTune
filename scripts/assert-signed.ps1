param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
$signature = Get-AuthenticodeSignature -LiteralPath $resolved.Path
if ($signature.Status -ne "Valid") {
  throw "Authenticode verification failed for $($resolved.Path): $($signature.Status)"
}

Write-Output "Valid Authenticode signature: $($signature.SignerCertificate.Subject)"

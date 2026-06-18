param(
  [Parameter(Mandatory=$true)]
  [string]$Folder,
  [string]$ApiBase = "http://localhost:4100",
  [string]$MappingCsv = "" # optional CSV file with columns: filename,entityPath (e.g. teams/{id} or competitions/{id})
)

if (-not (Test-Path $Folder)) { Write-Error "Folder not found: $Folder"; exit 1 }

$files = Get-ChildItem -Path $Folder -File | Where-Object { $_.Extension -match 'png|jpg|jpeg|gif|webp' }
$mapping = @{}
if ($MappingCsv -and (Test-Path $MappingCsv)) {
  Import-Csv -Path $MappingCsv | ForEach-Object { $mapping[$_.filename] = $_.entityPath }
}

foreach ($f in $files) {
  Write-Host "Uploading $($f.Name)..."
  $tmp = $f.FullName
  $resp = & curl.exe -s -F "file=@$tmp" "$ApiBase/upload/images"
  if ($LASTEXITCODE -ne 0) { Write-Host "Upload failed for $($f.Name)"; continue }
  try {
    $json = $resp | ConvertFrom-Json
  } catch {
    Write-Host "Invalid JSON response for $($f.Name): $resp"; continue
  }
  $url = $json.data.url
  Write-Host "Uploaded: $url"
  if ($mapping.ContainsKey($f.Name)) {
    $entityPath = $mapping[$f.Name]
    Write-Host "Updating $entityPath -> $url"
    $body = @{ logoUrl = $url } | ConvertTo-Json
    $update = & curl.exe -s -X PUT -H "Content-Type: application/json" -d $body "$ApiBase/$entityPath"
    Write-Host "Update response: $update"
  }
}

Write-Host "Batch upload complete."
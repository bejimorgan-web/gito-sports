$lines = netstat -ano | Select-String ':4100'
if ($lines) {
  foreach ($l in $lines) {
    $parts = ($l -split '\s+')
    $pid = $parts[-1]
    Write-Output "Killing PID $pid"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Output 'No process listening on port 4100'
}

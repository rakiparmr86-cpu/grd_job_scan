# Adds a Windows Firewall inbound rule so a phone on the same Wi-Fi can reach the GRD API.
# Usage:  powershell -ExecutionPolicy Bypass -File .\allow_api_port.ps1 [-Port 8001]
param([int]$Port = 8001)

$ruleName = "GRD API $Port"

# Re-launch as Administrator if needed (a UAC prompt will appear).
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port"
    exit
}

if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "Rule '$ruleName' already exists. Recreating it."
    Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule -DisplayName $ruleName `
    -Direction Inbound -Protocol TCP -LocalPort $Port `
    -Action Allow -Profile Private,Domain | Out-Null

Write-Host "Inbound rule '$ruleName' added (TCP $Port, Private + Domain networks)."
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' -and $_.InterfaceAlias -notlike 'vEthernet*' }).IPAddress
Write-Host "Test from your phone browser: http://$($ip | Select-Object -First 1):$Port/health"
Read-Host "Press Enter to close"

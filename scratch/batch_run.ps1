$root = "C:\Users\Burak\Github\bunchverse-assets\Source\Maps\Scenes"
$blender = "C:\Program Files\Blender Foundation\Blender 4.0\blender.exe"
$export_script = "C:\Users\Burak\life-giver\scratch\export_single.py"
$sync_script = "C:\Users\Burak\life-giver\scratch\sync_manifest.py"

$scenes = Get-ChildItem $root | Where-Object { $_.Attributes -match "Directory" }

foreach ($s in $scenes) {
    Write-Host "`n========================================"
    Write-Host " EXPORTING: $($s.Name)"
    Write-Host "========================================"
    & $blender -b --factory-startup -P $export_script -- "$($s.Name)"
    
    # Sync manifest after every scene to keep UI updated
    python $sync_script
}

Write-Host "`nBATCH EXPORT COMPLETED!"

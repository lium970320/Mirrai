param(
  [string]$Uin = "3321802943",
  [string]$OutputPath = "F:\.mirrai-local\Mirrai\secrets\qq-login-password-md5.dpapi"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Convert-SecureStringToPlainText([securestring]$SecureString) {
  if ($null -eq $SecureString) {
    return $null
  }

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Get-Md5Hex([string]$Text) {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return (($md5.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $md5.Dispose()
  }
}

$outputPathFull = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $outputPathFull
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

Write-Host "配置 QQ 快速登录兜底密码。"
Write-Host "账号：$Uin"
Write-Host "密码只会在本机内存中计算 MD5，并以当前 Windows 用户 DPAPI 加密后保存；不会明文落盘。"
Write-Host ""

$securePassword = Read-Host "请输入机器人 QQ 密码" -AsSecureString
if ($null -eq $securePassword -or $securePassword.Length -le 0) {
  throw "未输入密码，已取消。"
}

$plainPassword = $null
$passwordMd5 = $null
try {
  $plainPassword = Convert-SecureStringToPlainText $securePassword
  if ([string]::IsNullOrEmpty($plainPassword)) {
    throw "未输入密码，已取消。"
  }

  $passwordMd5 = Get-Md5Hex $plainPassword
  $encrypted = ConvertTo-SecureString -String $passwordMd5 -AsPlainText -Force | ConvertFrom-SecureString
  [System.IO.File]::WriteAllText($outputPathFull, $encrypted, [Text.UTF8Encoding]::new($false))
} finally {
  $plainPassword = $null
  $passwordMd5 = $null
  Remove-Variable plainPassword -ErrorAction SilentlyContinue
  Remove-Variable passwordMd5 -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "已配置 QQ 快速登录兜底密码：$outputPathFull"
Write-Host "后续 NapCat 快速登录态失效时，启动脚本会自动使用这个本机加密兜底。"

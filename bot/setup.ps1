# Qalta: one-time setup of the Telegram bot on free tiers (Cloudflare Workers + Firebase Spark).
# Run from the repository folder:   powershell -ExecutionPolicy Bypass -File bot\setup.ps1
# The bot token and the Firebase key go straight into Cloudflare's secret store. This script never prints them,
# never writes them into the repository, and removes its temporary file at once.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$botDir = $PSScriptRoot
$root = Split-Path -Parent $botDir
$project = "qalta-by-yerbo"

function Step($n, $text) { Write-Host ""; Write-Host ("[" + $n + "/6] " + $text) -ForegroundColor Cyan }
function Info($text) { Write-Host ("      " + $text) }
function Fail($text) { Write-Host ""; Write-Host ("Остановлено: " + $text) -ForegroundColor Red; exit 1 }
function Plain($secure) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function PostJson($url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 5 -Compress
  Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json))
}
function WriteUtf8($path, $text) { [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false)) }

Write-Host "Qalta: подключение Telegram-бота (бесплатно: Cloudflare Workers + Firebase Spark)" -ForegroundColor Green
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "нужен Node.js (nodejs.org)" }
Set-Location $botDir

# 1. Cloudflare account: signing in happens in your browser
Step 1 "Cloudflare: вход. Если аккаунта нет, на открывшейся странице есть регистрация (бесплатно)."
$who = (cmd /c "npx --yes wrangler whoami 2>&1" | Out-String)   # cmd merges stderr: PowerShell 5.1 would turn it into errors
if ($who -match "not authenticated" -or $who -notmatch "@") {
  Info "Сейчас откроется браузер: войдите в Cloudflare и нажмите Allow."
  & npx --yes wrangler login
  if ($LASTEXITCODE -ne 0) { Fail "вход в Cloudflare не завершён" }
}
Info "Cloudflare: вход выполнен."

# 2. The bot itself: created in Telegram by you. The token is taken from the clipboard (nothing to paste, nothing on screen)
Step 2 "Telegram: токен бота."
Add-Type -AssemblyName System.Windows.Forms
Info "В @BotFather отправьте /revoke и выберите своего бота (или /newbot, если бота ещё нет). Он пришлёт токен."
Info "Нажмите на токен в его сообщении: Telegram скопирует его. Затем вернитесь в это окно."
$token = $null; $username = $null
for ($try = 1; $try -le 5 -and -not $username; $try++) {
  $null = Read-Host "      Токен скопирован? Нажмите Enter"
  $clip = ""
  try { $clip = [string](Get-Clipboard -Raw) } catch {}
  $m = [regex]::Match($clip, '\d{5,}:[A-Za-z0-9_-]{30,}')
  if (-not $m.Success) { Write-Host "      В буфере обмена нет токена: нажмите на токен в сообщении BotFather ещё раз." -ForegroundColor Yellow; continue }
  $token = $m.Value
  try { $me = Invoke-RestMethod ("https://api.telegram.org/bot" + $token + "/getMe"); $username = $me.result.username }
  catch { Write-Host "      Telegram не принял этот токен (возможно, он уже отозван): скопируйте самый новый." -ForegroundColor Yellow; $token = $null }
}
try { [Windows.Forms.Clipboard]::Clear() } catch {}
if (-not $username) { Fail "токен так и не получен" }
Info ("Бот найден: @" + $username + ". Буфер обмена очищен.")
# 3. Firebase service-account key: downloaded by you, picked in a file dialog
Step 3 "Firebase: ключ сервисного аккаунта (бот пишет записи через него, тариф остаётся бесплатным)."
$keyPath = $null
$auto = Get-ChildItem (Join-Path $env:USERPROFILE "Downloads") -Filter ($project + "-firebase-adminsdk-*.json") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($auto) {
  $ans = Read-Host ("      Нашёл ключ в Загрузках: " + $auto.Name + ". Использовать его? (Enter: да, n: выбрать другой)")
  if ($ans -ne "n") { $keyPath = $auto.FullName }
}
if (-not $keyPath) {
  Start-Process ("https://console.firebase.google.com/project/" + $project + "/settings/serviceaccounts/adminsdk")
  Info "На открывшейся странице нажмите Generate new private key, затем Generate key. Скачается JSON-файл."
  $null = Read-Host "      Файл скачан? Нажмите Enter и выберите его в окне выбора файла"
  $dlg = New-Object Windows.Forms.OpenFileDialog
  $dlg.Title = "Ключ Firebase (JSON), скачанный только что"
  $dlg.Filter = "JSON (*.json)|*.json"
  $dlg.InitialDirectory = Join-Path $env:USERPROFILE "Downloads"
  $owner = New-Object Windows.Forms.Form -Property @{ TopMost = $true }
  if ($dlg.ShowDialog($owner) -ne [Windows.Forms.DialogResult]::OK) { Fail "файл ключа не выбран" }
  $keyPath = $dlg.FileName
}$keyText = [IO.File]::ReadAllText($keyPath)
try { $key = $keyText | ConvertFrom-Json } catch { Fail "файл не похож на ключ (не JSON)" }
if ($key.project_id -ne $project -or -not $key.client_email -or -not $key.private_key) { Fail ("это ключ не от проекта " + $project) }
Info ("Ключ проекта " + $project + " принят.")
# 4. Deploy the Worker, then hand it the secrets
Step 4 "Cloudflare: выкладываю бота и кладу секреты."
$url = $null
for ($try = 1; $try -le 3 -and -not $url; $try++) {
  $depOut = (cmd /c "npx --yes wrangler deploy 2>&1" | Out-String)
  $found = [regex]::Match($depOut, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if ($found.Success) { $url = $found.Value; break }
  $onb = [regex]::Match($depOut, 'https://dash\.cloudflare\.com/[0-9a-f]+/workers/onboarding')
  if (-not $onb.Success) { Write-Host $depOut; Fail "wrangler deploy не прошёл (текст выше)" }
  Info "Cloudflare просит один раз выбрать бесплатный поддомен вида имя.workers.dev (имя bot занято)."
  Start-Process $onb.Value
  Info "На открывшейся странице введите свободное имя, например qalta-yerbo, и подтвердите."
  $null = Read-Host "      Поддомен выбран? Нажмите Enter"
}
if (-not $url) { Fail "адрес бота так и не появился" }
Info ("Бот выложен: " + $url)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 24
$rng.GetBytes($bytes)
$webhookSecret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
$tmp = Join-Path $env:TEMP ("qalta-secrets-" + [guid]::NewGuid().ToString() + ".json")
try {
  WriteUtf8 $tmp ((@{ TG_TOKEN = $token; TG_SECRET = $webhookSecret; FIREBASE_SA = $keyText }) | ConvertTo-Json -Compress)
  & npx --yes wrangler secret bulk $tmp
  if ($LASTEXITCODE -ne 0) { Fail "секреты не сохранились (текст ошибки выше)" }
} finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
if ($url -notmatch '^https://[A-Za-z0-9.-]+\.workers\.dev$') { Fail "это не адрес workers.dev" }
$alive = $false
for ($i = 0; $i -lt 12 -and -not $alive; $i++) { try { $null = Invoke-WebRequest -UseBasicParsing $url; $alive = $true } catch { if ($i -eq 0) { Info "Новый адрес появляется в сети не сразу, жду до двух минут..." }; Start-Sleep -Seconds 10 } }
if (-not $alive) { Fail ("бот по адресу " + $url + " не отвечает; запустите скрипт ещё раз через пару минут") }
Info "Бот отвечает."

# 5. Point Telegram at the Worker
Step 5 "Telegram: направляю сообщения боту."
$r = PostJson ("https://api.telegram.org/bot" + $token + "/setWebhook") @{ url = ($url + "/telegram"); secret_token = $webhookSecret; allowed_updates = @("message", "callback_query"); drop_pending_updates = $true }
if (-not $r.ok) { Fail "Telegram не принял адрес бота" }
$cmds = @(
  @{ command = "month"; description = "Месяц: траты, доход, бюджет" },
  @{ command = "today"; description = "Записи за сегодня" },
  @{ command = "undo"; description = "Отменить последнюю запись" },
  @{ command = "help"; description = "Как писать" },
  @{ command = "stop"; description = "Отключить бота" })
$null = PostJson ("https://api.telegram.org/bot" + $token + "/setMyCommands") @{ commands = $cmds }
$token = $null; $keyText = $null; $key = $null
Info "Готово: Telegram шлёт сообщения боту."

# 6. The app learns the bot's name; Firestore rules allow the link codes
Step 6 "Приложение и правила Firestore."
$cfgPath = Join-Path $root "firebase-config.js"
$cfg = [IO.File]::ReadAllText($cfgPath)
$cfg = [regex]::Replace($cfg, 'window\.QALTA_TELEGRAM_BOT = "[^"]*";', ('window.QALTA_TELEGRAM_BOT = "' + $username + '";'))
WriteUtf8 $cfgPath $cfg
Info ("В приложение вписано имя бота: " + $username)
$ans = Read-Host "      Опубликовать правила Firestore сейчас? Без них не работают ни синхронизация, ни подключение бота (y/n)"
if ($ans -eq "y") {
  Set-Location $root
  Info "Сейчас откроется браузер: войдите в Google-аккаунт проекта Firebase и разрешите доступ."
  & npx --yes firebase-tools login
  & npx --yes firebase-tools deploy --only firestore:rules --project $project
  if ($LASTEXITCODE -ne 0) { Write-Host "      Правила не опубликованы (текст ошибки выше). Их можно вставить вручную: консоль Firebase -> Firestore -> Rules." -ForegroundColor Yellow }
  else { Info "Правила опубликованы." }
}
$del = Read-Host "      Ключ уже лежит в Cloudflare. Удалить скачанный файл ключа с компьютера? (y/n)"
if ($del -eq "y") { Remove-Item -LiteralPath $keyPath -Force; Info "Файл ключа удалён." }

Write-Host ""
Write-Host ("Готово. Бот: https://t.me/" + $username + ". Скажите Claude «готово»: он проверит и выложит приложение с кнопкой подключения.") -ForegroundColor Green

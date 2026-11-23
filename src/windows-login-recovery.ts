const restartInterval = 'PT1M';
const restartCount = 3;
export const windowsLoginRecoverySettings =
  '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' +
  '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' +
  `<RestartOnFailure><Interval>${restartInterval}</Interval><Count>${restartCount}</Count></RestartOnFailure>`;

export function windowsLoginRecoveryMigration(legacyXml: string): string {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `
$ErrorActionPreference = 'Stop'
function Get-Sid([string] $account) {
  if ($account -match '^S-[0-9-]+$') { return $account }
  return ([Security.Principal.NTAccount]::new($account)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Normalize-Task([string] $text) {
  [xml] $document = $text
  foreach ($user in $document.SelectNodes("//*[local-name()='UserId']")) {
    $user.InnerText = Get-Sid $user.InnerText
  }
  return $document.DocumentElement.OuterXml
}
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\\')
try { $task = $folder.GetTask('MoRemoteCLI') } catch {
  if ($_.Exception.HResult -eq -2147024894) { return }
  throw
}
if (!$task.Enabled) { return }
$definition = $task.Definition
$principal = $definition.Principal
if ($definition.Triggers.Count -ne 1 -or $principal.LogonType -ne 3 -or $principal.RunLevel -ne 0) { return }
$logon = $definition.Triggers.Item(1)
if ($logon.Type -ne 9 -or !$logon.Enabled) { return }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ((Get-Sid $principal.UserId) -ne $sid -or (Get-Sid $logon.UserId) -ne $sid) { return }

$baseline = $scheduler.NewTask(0)
$baseline.XmlText = ${literal(legacyXml)}
if ($definition.RegistrationInfo.URI -ceq $task.Path) { $baseline.RegistrationInfo.URI = $task.Path }
$original = $definition.XmlText
if ((Normalize-Task $baseline.XmlText) -cne (Normalize-Task $original)) { return }

$settings = $definition.Settings
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
$settings.RestartInterval = '${restartInterval}'
$settings.RestartCount = ${restartCount}

$current = $folder.GetTask('MoRemoteCLI')
if (!$current.Enabled -or $current.Definition.XmlText -cne $original) { return }
# UPDATE | DONT_ADD_PRINCIPAL_ACE | IGNORE_REGISTRATION_TRIGGERS
$null = $folder.RegisterTaskDefinition('MoRemoteCLI', $definition, 52, $principal.UserId, $null, 3, $null)
`;
}

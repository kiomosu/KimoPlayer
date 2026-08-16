#define MyAppName "KimoPlayer"
#define MyAppVersion "1.8.5"
#define MyAppPublisher "kiomosu"
#define MyAppExeName "KimoPlayer.exe"

[Setup]
AppId={{5E98B072-358A-4560-84E3-8EE96A3906CD}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist-installer
OutputBaseFilename=KimoPlayer-{#MyAppVersion}-setup
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ChangesAssociations=yes
WizardImageFile=..\assets\installer-sidebar.bmp
WizardSmallImageFile=..\src-tauri\icons\128x128.png

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加选项:"; Flags: checkedonce
Name: "startup"; Description: "开机自动启动 KimoPlayer"; GroupDescription: "附加选项:"; Flags: unchecked

[Files]
Source: "..\dist-exe\KimoPlayer-{#MyAppVersion}-safe.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autostartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 KimoPlayer"; Flags: nowait postinstall skipifsilent

' Starts RH Freemint Hunter with no console window.
'
' Put this next to RH-Freemint-Hunter.exe and double-click it instead of the
' .exe. The bot runs in the background; close it with the "Quit app" button on
' the dashboard, since there is no window to close.
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = here & "\RH-Freemint-Hunter.exe"

If Not fso.FileExists(exePath) Then
  MsgBox "RH-Freemint-Hunter.exe was not found in this folder." & vbCrLf & vbCrLf & _
         "Keep this file next to the .exe.", vbExclamation, "RH Freemint Hunter"
  WScript.Quit 1
End If

shell.CurrentDirectory = here
' 0 = hidden window, False = do not wait for it to finish
shell.Run """" & exePath & """", 0, False

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = "C:\Users\interojo\AppData\Local\Programs\Python\Python313\python.exe"
backup = root & "\scripts\backup.py"
shell.Run """" & pythonw & """ """ & backup & """", 0, False

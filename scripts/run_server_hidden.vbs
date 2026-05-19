Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
pythonw = "C:\Users\interojo\AppData\Local\Programs\Python\Python313\python.exe"
server = root & "\scripts\server.py"
shell.Run """" & pythonw & """ """ & server & """", 0, False

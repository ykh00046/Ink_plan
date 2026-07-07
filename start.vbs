Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = """" & root & "\scripts\run_server_hidden.vbs" & """"
shell.Run "wscript.exe " & cmd, 0, False

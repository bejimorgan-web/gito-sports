import subprocess,sys
p=subprocess.run(["C:\\Users\\Utilisateur\\Desktop\\UOM\\flutter_windows_3.41.4-stable\\flutter\\bin\\flutter.bat","--version"], capture_output=True, text=True)
print("returncode=%s" % p.returncode)
sys.stdout.write(p.stdout)
sys.stderr.write(p.stderr)

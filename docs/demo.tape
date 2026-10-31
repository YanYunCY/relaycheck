# Reproducible demo GIF: `vhs docs/demo.tape` from the repo root (needs vhs, ttyd, chromium).
# The long identity phase of runs A and B is cut (Hide/Wait/Show) to keep the GIF short; output is unedited.
# Local mock relays only (scripts/demo-setup.sh): no real API is called and no real key is used.
Output docs/demo.gif
Set Shell bash
Set FontFamily "JetBrains Mono"
Set FontSize 13
Set LineHeight 1.2
Set Width 1000
Set Height 720
Set Padding 22
Set Framerate 12
Set TypingSpeed 12ms
Set Theme { "name": "rc", "background": "#0d1117", "foreground": "#e6edf3", "cursor": "#e6edf3", "selection": "#30363d", "black": "#484f58", "red": "#ff6b6b", "green": "#3fdc7a", "yellow": "#f2c94c", "blue": "#58a6ff", "magenta": "#d2a8ff", "cyan": "#56d4dd", "white": "#e6edf3", "brightBlack": "#8b949e", "brightRed": "#ff8a8a", "brightGreen": "#56e39f", "brightYellow": "#f5d76e", "brightBlue": "#79c0ff", "brightMagenta": "#e2c5ff", "brightCyan": "#76e3ea", "brightWhite": "#ffffff" }
Env LANG "en_US.UTF-8"

Hide
Type "source scripts/demo-setup.sh && intro" Enter
Sleep 1.5s
Show
Sleep 1.8s

Hide
Type "clear" Enter
Sleep 200ms
Show
Type "npx relaycheck http://localhost:8787 --model mock-sonnet --ref refs/mock-honest.json   # relay A" Sleep 300ms Enter
Sleep 0.8s
Hide
Wait+Line@60s /relaycheck \$ ?$/
Show
Sleep 2.5s

Hide
Type "clear" Enter
Sleep 200ms
Show
Type "npx relaycheck http://localhost:8788 --model mock-sonnet --ref refs/mock-honest.json   # relay B" Sleep 300ms Enter
Sleep 0.8s
Hide
Wait+Line@60s /relaycheck \$ ?$/
Show
Sleep 3.6s

Hide
Type "clear" Enter
Sleep 200ms
Show
Type "npx relaycheck http://localhost:8789 --model mock-sonnet --ref refs/mock-honest.json --probes billing" Sleep 300ms Enter
Wait+Line@60s /relaycheck \$ ?$/
Sleep 2.4s

Hide
Type "outro" Enter
Sleep 400ms
Show
Sleep 2.4s

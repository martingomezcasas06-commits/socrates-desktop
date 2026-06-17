# Socrates Desktop App — Claude Design source

The desktop app redesign (960×680 resizable native window). Recovered from the
exported standalone (gzip+base64-inlined, decoded).

- `shell.html` — full CSS design system + the macOS prototype scaffolding
  (#scene/.wallpaper/.menubar/.window are PROTOTYPE-ONLY; the real Tauri window
  is the OS window, so port `.window-body` = `.rail` + `.content` and inward).
- `desktop-app.js` — all screen renderers: screenLogin, screenStack, screenChat,
  screenCoaching (coachIdle/coachLive/offerCard/control/coachDone), renderCompanion.

Implement into desktop/src: AuthPage, StackPage, ChatPage, CoachingPage + App shell
(nav rail). Set tauri.conf.json window to 960×680, resizable, alwaysOnTop:false
(only the floating companion is always-on-top).

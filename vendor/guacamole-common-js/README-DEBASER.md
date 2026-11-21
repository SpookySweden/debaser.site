# guacamole-common-js, pinned for SCREENS' Remote Desktop way in

The browser half of Apache Guacamole (SPEC-screens.md, "The server: Remote Desktop", Luke 2026-11-21). It draws a
Windows Remote Desktop that guacd (Guacamole's translator, in Docker on the PC) turns into the Guacamole protocol, and
sends the mouse and keys back. Used by `app/components/RoomRdpScreen.tsx` only, loaded when that view opens.

- Source: Apache Guacamole 1.5.0's `guacamole-common-js` modules, concatenated with `export default Guacamole;` at the
  end, as published to npm as `guacamole-common-js@1.5.0` (`dist/esm/guacamole-common.js`, a republish of the Apache
  source by github.com/padarom/guacamole-common-js). Matches guacd 1.5.5 (the same 1.5 protocol).
- sha256 `038360093fe5939e58cc3a6c84bd70337abcb792f2ed0f6a025f4508b1e28fca`. Copied 2026-11-21.
- Licence: Apache 2.0, `LICENSE`.
- No changes from the published file. Copied rather than installed so `package.json` stays as it is; the site's
  bundler builds it in, nothing is fetched from a CDN at run time.
- Typed by hand where it is used (`app/lib/screens/guacamole.ts`), only the parts the view calls.

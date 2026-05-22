-- Fonte router applet
--
-- This AppleScript is compiled into Fonte.app/Contents/MacOS/applet. It receives
-- AppleEvents from macOS (open documents, open URL, plain launch) and forwards
-- them as command-line arguments to fonte-router.sh, which does the actual work.
--
-- A bash CFBundleExecutable can't receive AppleEvents on modern macOS, so
-- "Open with Fonte" on a .torrent never reached the script. This applet fixes
-- that without changing the routing logic.

on routerPath()
	return POSIX path of (path to me) & "Contents/Resources/fonte-router.sh"
end routerPath

on runRouter(theArgs)
	set cmd to quoted form of routerPath()
	repeat with a in theArgs
		set cmd to cmd & " " & quoted form of (a as text)
	end repeat
	do shell script cmd & " >/dev/null 2>&1 &"
end runRouter

on run
	runRouter({})
end run

on open theFiles
	set paths to {}
	repeat with f in theFiles
		set end of paths to POSIX path of f
	end repeat
	runRouter(paths)
end open

on open location theURL
	runRouter({theURL})
end open
